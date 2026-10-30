import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../src/rule-repos/catalog.ts';
import { buildEntries, BUILTIN_REPOS } from '../src/rule-repos/adapters.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const env = await setupRuleReferences(); envs.push(env); return env; };

describe('物理文件平铺搜索与分页', () => {
  it('按完整 URL 提示单个仓库文件，忽略未关联文件和停用仓库', async () => {
    const h = await setup();
    const path = 'rule/Surge/Google/Google.list';
    const url = `https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/${path}`;
    const matched = await h.admin.post('/api/rule-options/match-urls', { urls: [url + '#preview', url, url + '?v=2', 'https://example.test/Google.list'] });
    expect(matched.status).toBe(200);
    expect(matched.json.matches[url]).toEqual([{ repo: 'blackmatrix7', entry: 'Google', ref: 'master', path, label: 'Google.list', hint: `blackmatrix7/ios_rule_script · master · ${path}` }]);
    expect(Object.keys(matched.json.matches)).toEqual([url]);
    expect(h.reads).toEqual([]);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'Google', file: { ref: 'master', path } })).json.matcher.repository.sources).toHaveLength(1);
    h.store.db.prepare('UPDATE rule_repo_catalog SET data = ? WHERE repo = ?').run(JSON.stringify([{ kind: 'file', ref: 'master', path: 'rule/Surge/Google/unlinked.list' }]), 'blackmatrix7');
    expect((await h.admin.post('/api/rule-options/match-urls', { urls: [url] })).json.matches).toEqual({});
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.post('/api/rule-options/match-urls', { urls: [url] })).json.matches).toEqual({});
    expect((await client(h.app).post('/api/rule-options/match-urls', { urls: [url] })).status).toBe(401);
  });

  it('只缓存文本文件，完整路径与分支独立，重叠扫描不重复', () => {
    const original = BUILTIN_REPOS[0]!;
    const repo = { ...original, scans: [...original.scans, original.scans[0]!, { ...original.scans[0]!, ref: 'other' }] };
    const paths = ['rule/Clash/China/China.list', 'rule/Surge/China/China.list', 'rule/Clash/root.TXT', 'rule/Clash/China/data.yaml', 'outside/no.list'];
    const trees = { master: paths, other: paths };
    const nodes = buildCatalog(repo, trees, buildEntries(repo, trees));
    expect(nodes.every(node => node.kind === 'file')).toBe(true);
    expect(nodes.filter(node => node.path.endsWith('/China.list'))).toHaveLength(3);
    expect(nodes.some(node => node.path.endsWith('.yaml') || node.path.startsWith('outside/'))).toBe(false);
    expect(new Set(nodes.map(node => JSON.stringify([node.ref, node.path]))).size).toBe(nodes.length);
  });

  it('初始直接分页文件，同名路径独立，搜索未加载文件且不调用全量文件接口', async () => {
    const h = await setup();
    h.setPaths(['Clash', 'Surge'].flatMap(directory => Array.from({ length: 35 }, (_, i) => `rule/${directory}/China/file-${String(i).padStart(2, '0')}.list`)));
    await h.repos.refresh('blackmatrix7');
    const full = vi.spyOn(h.repos, 'searchFiles').mockImplementation(() => { throw new Error('不得读取全量文件'); });
    const items = [];
    for (const offset of [0, 30, 60]) {
      const page = (await h.admin.get(`/api/rule-options/search?scope=repository&offset=${offset}`)).json;
      expect(page).toMatchObject({ total: 70, offset, limit: 30 });
      expect(page.items).toHaveLength(offset === 60 ? 10 : 30);
      expect(page.nextOffset).toBe(offset === 60 ? undefined : offset + 30);
      items.push(...page.items);
    }
    expect(new Set(items.map(item => item.value)).size).toBe(70);
    const searched = (await h.admin.get('/api/rule-options/search?scope=repository&q=file-34')).json;
    expect(searched.items).toHaveLength(2);
    expect(searched.items.map((item: { value: string }) => JSON.parse(item.value).file.path)).toEqual(['rule/Clash/China/file-34.list', 'rule/Surge/China/file-34.list']);
    expect(searched.items[0]).toMatchObject({ label: 'file-34.list', hint: 'blackmatrix7/ios_rule_script · rule/Clash/China/' });
    expect((await h.admin.get('/api/rule-options/search?offset=999')).json).toMatchObject({ items: [], total: 71 });
    expect(full).not.toHaveBeenCalled();
    expect(h.reads).toEqual([]);
    full.mockRestore();
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.get('/api/rule-options/search?scope=repository')).json.items).toEqual([]);
  });

  it('先搜索再分页，匹配路径、Unicode 大小写和字面通配字符', async () => {
    const h = await setup();
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/100%_Target.list', 'rule/Clash/China/100XXTarget.list', 'rule/Clash/Other/ÄPFEL.txt']);
    await h.repos.refresh('blackmatrix7');
    const search = async (q: string) => (await h.admin.get(`/api/rule-options/search?scope=repository&q=${encodeURIComponent(q)}`)).json;
    expect((await search('CHINA')).total).toBe(3);
    expect((await search('%_')).items).toMatchObject([{ label: '100%_Target.list' }]);
    expect((await search('äpfel')).items).toMatchObject([{ label: 'ÄPFEL.txt' }]);
    expect((await search('blackmatrix7')).total).toBe(0);
    expect((await search('missing')).total).toBe(0);
  });

  it('搜索 ai 不因仓库名 domain 或分支 domain 命中无关文件，仍按实际路径分页', async () => {
    const h = await setup();
    h.repos.setEnabled('blackmatrix7', false);
    h.setPaths(['36kr.txt', '4399.txt', 'AI.txt', 'OpenAI.txt',
      ...Array.from({ length: 35 }, (_, index) => `AI/File-${String(index).padStart(2, '0')}.txt`)]);
    const repo = await h.repos.addCustom({ url: 'https://github.com/example/search-fixture', name: 'v2fly-domain-list', ref: 'surge-domain-set' });
    await h.repos.refresh(repo);
    const search = async (q: string, offset = 0) => (await h.admin.get(`/api/rule-options/search?scope=repository&q=${encodeURIComponent(q)}&offset=${offset}`)).json;
    for (const q of ['ai', 'AI', 'ＡＩ']) {
      const first = await search(q);
      const second = await search(q, 30);
      expect(first).toMatchObject({ total: 37, nextOffset: 30 });
      expect(first.items).toHaveLength(30);
      expect(first.items[0].label).toBe('AI.txt');
      expect(second.items).toHaveLength(7);
      expect(second.nextOffset).toBeUndefined();
      const items = [...first.items, ...second.items];
      expect(new Set(items.map(item => item.value)).size).toBe(37);
      expect(items.some(item => ['36kr.txt', '4399.txt'].includes(item.label))).toBe(false);
      expect(items.some(item => item.label === 'OpenAI.txt')).toBe(true);
      expect(items.every(item => JSON.parse(item.value).file.path.toLowerCase().includes('ai'))).toBe(true);
    }
    expect((await search('v2fly')).total).toBe(0);
    expect((await search('surge-domain-set')).total).toBe(0);
    expect((await search('36kr')).items).toMatchObject([{ label: '36kr.txt', hint: 'v2fly-domain-list' }]);
    expect((await search('')).total).toBe(39);
  });

  it('第二行仅显示目录，高亮真实路径命中并支持跨目录与文件名的查询', async () => {
    const h = await setup();
    h.repos.setEnabled('blackmatrix7', false);
    h.setPaths(['AI/OpenＡＩ.txt', 'OpenAI.txt', '36kr.txt']);
    const repo = await h.repos.addCustom({ url: 'https://github.com/example/highlight-fixture', name: 'v2fly-domain-list', ref: 'surge-domain-set' });
    await h.repos.refresh(repo);
    const search = async (q: string) => (await h.admin.get(`/api/rule-options/search?q=${encodeURIComponent(q)}`)).json;
    const marked = (item: { label: string; hint: string; matches: { label: { start: number; end: number }[]; hint: { start: number; end: number }[] } }, field: 'label' | 'hint') => item.matches[field].map(range => item[field].slice(range.start, range.end));
    const page = await search('ai');
    expect(page.total).toBe(2);
    const nested = page.items.find((item: { label: string }) => item.label === 'OpenＡＩ.txt');
    expect(nested.hint).toBe('v2fly-domain-list · AI/');
    expect(marked(nested, 'label')).toEqual(['ＡＩ']);
    expect(marked(nested, 'hint')).toEqual(['AI']);
    const root = page.items.find((item: { label: string }) => item.label === 'OpenAI.txt');
    expect(root.hint).toBe('v2fly-domain-list');
    expect(marked(root, 'label')).toEqual(['AI']);
    expect(marked(root, 'hint')).toEqual([]);
    expect(JSON.parse(nested.value).file.path).toBe('AI/OpenＡＩ.txt');
    const cross = (await search('ai/openai')).items[0];
    expect(marked(cross, 'hint')).toEqual(['AI/']);
    expect(marked(cross, 'label')).toEqual(['OpenＡＩ']);
    const local = (await search('google')).items[0];
    expect(marked(local, 'label')).toEqual(['Google']);
    expect((await search('')).items.every((item: typeof nested) => !item.matches.label.length && !item.matches.hint.length)).toBe(true);
  });

  it('同仓库跨页出现多个分支时才显示分支，搜索缩小到单分支后隐藏', async () => {
    const h = await setup();
    const nodes = [
      ...Array.from({ length: 35 }, (_, index) => ({ kind: 'file', ref: 'main', path: `AI/a-${String(index).padStart(2, '0')}.txt`, entry: 'AI' })),
      { kind: 'file', ref: 'alternate', path: 'z-ai.txt', entry: 'AI' },
    ];
    h.store.db.prepare('UPDATE rule_repo_catalog SET data = ? WHERE repo = ?').run(JSON.stringify(nodes), 'blackmatrix7');
    const search = async (q: string, offset = 0) => (await h.admin.get(`/api/rule-options/search?scope=repository&q=${encodeURIComponent(q)}&offset=${offset}`)).json;
    const first = await search('ai');
    const second = await search('ai', 30);
    expect(first).toMatchObject({ total: 36, nextOffset: 30 });
    expect(first.items.every((item: { hint: string; value: string }) => item.hint === 'blackmatrix7/ios_rule_script * main * AI/' && JSON.parse(item.value).file.ref === 'main')).toBe(true);
    expect(second.items.at(-1)).toMatchObject({ label: 'z-ai.txt', hint: 'blackmatrix7/ios_rule_script * alternate' });
    const highlighted = first.items[0];
    expect(highlighted.matches.hint.map((range: { start: number; end: number }) => highlighted.hint.slice(range.start, range.end))).toEqual(['AI']);
    expect((await search('AI/a-')).items.every((item: { hint: string }) => item.hint === 'blackmatrix7/ios_rule_script · AI/')).toBe(true);
    expect((await search('z-ai')).items).toMatchObject([{ label: 'z-ai.txt', hint: 'blackmatrix7/ios_rule_script' }]);
    expect((await search('google')).total).toBe(0);
  });

  it('不同仓库的不同分支不触发分支展示，同名文件仍保留独立选择值', async () => {
    const h = await setup();
    h.repos.setEnabled('zydou', true);
    const save = h.store.db.prepare('INSERT OR REPLACE INTO rule_repo_catalog (repo, data) VALUES (?, ?)');
    save.run('blackmatrix7', JSON.stringify([{ kind: 'file', ref: 'master', path: 'same.txt', entry: 'same' }]));
    save.run('zydou', JSON.stringify([{ kind: 'file', ref: 'surge-domain-set', path: 'same.txt', entry: 'same' }]));
    const page = (await h.admin.get('/api/rule-options/search?scope=repository&q=same')).json;
    expect(page.items).toHaveLength(2);
    const names = new Map(h.repos.list().map(repo => [repo.id, repo.name]));
    for (const item of page.items) expect(item.hint).toBe(names.get(JSON.parse(item.value).repo));
    expect(new Set(page.items.map((item: { value: string }) => item.value)).size).toBe(2);
  });

  it('本地候选共用分页，鉴权、私有隔离与分页上限保持有效', async () => {
    const h = await setup();
    const local = h.store.get('ruleset', 'local-google')!;
    for (let i = 0; i < 65; i++) h.store.put('ruleset', { ...local, id: `local-${i}`, name: `候选 ${String(i).padStart(2, '0')}` }, h.user.id);
    const first = (await h.admin.get('/api/rule-options/search?q=候选')).json;
    expect(first).toMatchObject({ total: 65, nextOffset: 30 });
    expect(first.items).toHaveLength(30);
    expect((await h.admin.get('/api/rule-options/search?q=候选&offset=60')).json.items).toHaveLength(5);
    expect((await h.admin.get('/api/rule-options/search?q=私有')).json.total).toBe(0);
    expect((await client(h.app).get('/api/rule-options/search')).status).toBe(401);
    for (const query of ['offset=-1', 'offset=1.2', 'offset=9007199254740992', 'limit=0', 'limit=101', 'limit=abc', 'scope=bad']) {
      expect((await h.admin.get(`/api/rule-options/search?${query}`)).status, query).toBe(400);
    }
  });

  it('兼容旧目录缓存，分支身份独立，不可关联文件仍能预览', async () => {
    const h = await setup();
    const data = [{ kind: 'directory', ref: 'master', path: 'rule' },
      ...['master', 'other'].map(ref => ({ kind: 'file', ref, path: 'rule/Surge/Google/Google.list', entry: 'Google' })),
      { kind: 'file', ref: 'master', path: 'rule/unlinked.txt' }];
    h.store.db.prepare('UPDATE rule_repo_catalog SET data = ? WHERE repo = ?').run(JSON.stringify(data), 'blackmatrix7');
    const page = (await h.admin.get('/api/rule-options/search?scope=repository')).json;
    expect(page.items).toHaveLength(3);
    expect(new Set(page.items.map((item: { value: string }) => item.value)).size).toBe(3);
    expect(page.items.find((item: { label: string }) => item.label === 'unlinked.txt').disabled).toBe(true);
    expect((await h.admin.get('/api/rule-repos/file-preview?repo=blackmatrix7&ref=master&path=rule/unlinked.txt')).status).toBe(200);
  });

  it('旧缓存缺失仍在数据库分页，补建失败保留已有索引', async () => {
    const h = await setup();
    h.setPaths(Array.from({ length: 40 }, (_, i) => `rule/Clash/Many/file-${i}.list`));
    await h.repos.refresh('blackmatrix7');
    const search = async () => (await h.admin.get('/api/rule-options/search?scope=repository')).json;
    const before = await search();
    h.store.db.prepare('DELETE FROM rule_repo_catalog WHERE repo = ?').run('blackmatrix7');
    const fallback = await search();
    expect(fallback).toMatchObject({ total: 40, nextOffset: 30 });
    expect(fallback.items).toEqual(before.items);
    expect(fallback.notices.join('')).toContain('完整文件索引待更新');
    await h.repos.refresh('blackmatrix7');
    expect(await search()).toEqual(before);
    h.store.db.exec("CREATE TRIGGER block_catalog BEFORE INSERT ON rule_repo_catalog BEGIN SELECT RAISE(ABORT, '模拟文件索引写入失败'); END");
    h.setPaths(['rule/Clash/new/new.list']);
    // 模拟上游提交变化，确保执行完整重建而非同提交快速跳过。
    h.store.db.prepare("UPDATE rule_repos SET revisions = '{}' WHERE id = ?").run('blackmatrix7');
    await h.repos.refresh('blackmatrix7');
    expect(h.repos.list().find(repo => repo.id === 'blackmatrix7')?.error).toContain('模拟文件索引写入失败');
    expect((await search()).items).toEqual(before.items);
  });

  it('列表选中单文件仅保存该文件映射，模板与订阅可保存渲染，伪造文件被拒绝', async () => {
    const h = await setup();
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list']);
    await h.repos.refresh('blackmatrix7');
    const resolve = async (path: string) => h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'China', file: { ref: 'master', path } });
    const clash = await resolve('rule/Clash/China/China.list');
    const surge = await resolve('rule/Surge/China/China.list');
    expect(clash.status).toBe(200); expect(surge.status).toBe(200);
    const matcher = clash.json.matcher;
    expect(matcher.repository.sources).toHaveLength(1);
    expect(matcher.repository.sources[0]).toMatchObject({ format: 'auto', repository: { ref: 'master', path: 'rule/Clash/China/China.list' } });
    expect(surge.json.matcher.id).not.toBe(matcher.id);
    expect((await resolve('rule/Clash/China/fake.list')).status).toBe(400);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'China', file: null })).status).toBe(400);
    const rules = [{ id: 'r', matcher, target: { kind: 'builtin', name: 'REJECT' } }];
    const published = await h.admin.post('/api/templates/new/publish', { name: '列表文件模板', groups: [], rules, final: { kind: 'builtin', name: 'DIRECT' } });
    expect(published.status).toBe(201);
    const saved = await h.admin.post('/api/profiles', { name: '列表文件订阅', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: rules[0] }] } });
    expect(saved.status).toBe(201);
    expect((await h.renderer.preview(saved.json.item.id, { client: 'mihomo' })).ok).toBe(true);
    expect(h.store.list('ruleset')).toHaveLength(2);
  });

});
