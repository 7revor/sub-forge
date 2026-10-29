import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../src/rule-repos/catalog.ts';
import { buildEntries, BUILTIN_REPOS } from '../src/rule-repos/adapters.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const env = await setupRuleReferences(); envs.push(env); return env; };

describe('物理文件平铺搜索与分页', () => {
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
    expect(searched.items[0]).toMatchObject({ label: 'file-34.list', hint: 'blackmatrix7/ios_rule_script · rule/Clash/China/file-34.list · 分支：master' });
    expect((await h.admin.get('/api/rule-options/search?offset=999')).json).toMatchObject({ items: [], total: 71 });
    expect(full).not.toHaveBeenCalled();
    expect(h.reads).toEqual([]);
    full.mockRestore();
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.get('/api/rule-options/search?scope=repository')).json.items).toEqual([]);
  });

  it('先搜索再分页，匹配路径、仓库、Unicode 大小写和字面通配字符', async () => {
    const h = await setup();
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/100%_Target.list', 'rule/Clash/China/100XXTarget.list', 'rule/Clash/Other/ÄPFEL.txt']);
    await h.repos.refresh('blackmatrix7');
    const search = async (q: string) => (await h.admin.get(`/api/rule-options/search?scope=repository&q=${encodeURIComponent(q)}`)).json;
    expect((await search('CHINA')).total).toBe(3);
    expect((await search('%_')).items).toMatchObject([{ label: '100%_Target.list' }]);
    expect((await search('äpfel')).items).toMatchObject([{ label: 'ÄPFEL.txt' }]);
    expect((await search('blackmatrix7')).total).toBe(4);
    expect((await search('missing')).total).toBe(0);
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
