import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../src/rule-repos/catalog.ts';
import { buildEntries, BUILTIN_REPOS } from '../src/rule-repos/adapters.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const env = await setupRuleReferences(); envs.push(env); return env; };

describe('平面目录索引与级联文件引用', () => {
  it('只保存目录和 list/txt，保留深层分类、扫描根、分支与同名文件身份', () => {
    const repo = BUILTIN_REPOS[0]!;
    const master = ['rule/Clash/root.txt', 'rule/Clash/China/China.list', 'rule/Surge/China/China.list', 'rule/Clash/Cloud/Dropbox/Dropbox.TXT', 'rule/Clash/YamlOnly/data.yaml', 'rule/Clash/China/README.md', 'outside/no.list'];
    const entries = buildEntries(repo, { master });
    const nodes = buildCatalog(repo, { master }, entries);
    expect(nodes.filter(node => node.kind === 'file').map(node => node.path).sort()).toEqual(master.filter(path => /^rule\//.test(path) && /\.(list|txt)$/i.test(path)).sort());
    expect(nodes).toContainEqual({ kind: 'directory', ref: 'master', root: 'rule/Clash', path: 'rule/Clash/Cloud/Dropbox' });
    expect(nodes).toContainEqual({ kind: 'directory', ref: 'master', root: 'rule/Clash', path: 'rule/Clash/YamlOnly' });
    expect(nodes.find(node => node.path === 'rule/Clash/root.txt')).toMatchObject({ kind: 'file', entry: 'root', root: 'rule/Clash' });
    expect(nodes.filter(node => node.kind === 'file' && node.path.endsWith('/China.list'))).toHaveLength(2);
    expect(new Set(nodes.map(node => JSON.stringify([node.kind, node.ref, node.path]))).size).toBe(nodes.length);
  });

  it('根目录分页只返回可见本地与启用仓库，不携带文件，展开再分页读取', async () => {
    const h = await setup();
    expect((await client(h.app).get('/api/rule-options/catalog')).status).toBe(401);
    expect((await h.admin.get('/api/rule-options/catalog?scope=bad')).status).toBe(400);
    const first = await h.admin.get('/api/rule-options/catalog?limit=1');
    expect(first.json).toMatchObject({ total: 2, offset: 0, limit: 1, nextOffset: 1, items: [{ kind: 'local', id: 'local-google' }] });
    expect((await h.admin.get('/api/rule-options/catalog?limit=1&offset=1')).json).toMatchObject({ items: [{ kind: 'repository', repo: 'blackmatrix7' }], total: 2 });
    expect((await h.admin.get('/api/rule-options/catalog?scope=repository')).json.items).toHaveLength(1);
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list', 'rule/Clash/China/data.yaml']);
    await h.repos.refresh('blackmatrix7');
    const second = await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/China');
    expect(second.json.items).toHaveLength(2);
    expect(second.json.items.every((node: { entry: string; path: string }) => node.entry === 'China' && node.path.endsWith('.list'))).toBe(true);
    expect(new Set(second.json.items.map((node: { path: string }) => node.path)).size).toBe(2);
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.get('/api/rule-options/catalog?scope=repository')).json.items).toEqual([]);
    expect((await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7')).status).toBe(404);
  });

  it('保留原始 Clash、Surge 目录，同名文件在各自目录独立分页和搜索', async () => {
    const h = await setup();
    h.setPaths(['Clash', 'Surge'].flatMap(directory => Array.from({ length: 35 }, (_, i) => `rule/${directory}/China/file-${String(i).padStart(2, '0')}.list`)));
    await h.repos.refresh('blackmatrix7');
    const list = async (directory: string, extra = '') => (await h.admin.get(`/api/rule-options/catalog?repo=blackmatrix7&directory=${directory}${extra}`)).json;
    expect((await list('')).items).toEqual([{ kind: 'directory', repo: 'blackmatrix7', name: 'rule', path: 'rule' }]);
    expect(await list('rule', '&limit=1')).toMatchObject({ total: 2, nextOffset: 1, items: [{ name: 'Clash', path: 'rule/Clash' }] });
    expect(await list('rule', '&limit=1&offset=1')).toMatchObject({ total: 2, items: [{ name: 'Surge', path: 'rule/Surge' }] });
    for (const directory of ['Clash', 'Surge']) {
      const path = `rule/${directory}/China`;
      expect((await list(`rule/${directory}`)).items).toEqual([{ kind: 'directory', repo: 'blackmatrix7', name: 'China', path }]);
      const first = await list(path);
      const last = await list(path, '&offset=30');
      expect(first).toMatchObject({ total: 35, nextOffset: 30 });
      expect(first.items).toHaveLength(30);
      expect(last).toMatchObject({ total: 35 });
      expect(last.items).toHaveLength(5);
      expect([...first.items, ...last.items].every((item: { path: string }) => item.path.startsWith(`${path}/`))).toBe(true);
      expect((await list(path, '&q=file-34')).items).toMatchObject([{ path: `${path}/file-34.list` }]);
    }
    expect((await list('rule', '&q=file-34')).items.map((item: { path: string }) => item.path)).toEqual(['rule/Clash', 'rule/Surge']);
    expect((await list('China')).items).toEqual([]);
    expect(h.reads).toEqual([]);
  });

  it('默认每页 30 项，每层稳定翻页不重不漏，后代不会随父目录返回', async () => {
    const h = await setup();
    h.setPaths([...Array.from({ length: 75 }, (_, i) => `rule/Clash/Many/file-${String(i).padStart(3, '0')}.list`),
      'rule/Clash/Cloud/Dropbox/deep.txt', 'rule/Clash/root.list']);
    await h.repos.refresh('blackmatrix7');
    const fullCatalog = vi.spyOn(h.repos, 'catalog').mockImplementation(() => { throw new Error('分页不应读取全量目录'); });
    const root = (await h.admin.get('/api/rule-options/catalog?scope=repository')).json;
    expect(root.items).toEqual([{ kind: 'repository', repo: 'blackmatrix7', name: 'blackmatrix7/ios_rule_script' }]);
    const repo = (await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7')).json;
    expect(repo.items.map((item: { name: string }) => item.name)).toEqual(['rule']);
    const clash = (await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash')).json;
    expect(clash.items.map((item: { name: string }) => item.name)).toEqual(['Cloud', 'Many', 'root.list']);
    expect(repo.items.every((item: object) => !('children' in item) && !('nodes' in item))).toBe(true);
    const pages = [];
    for (const offset of [0, 30, 60]) {
      const page = (await h.admin.get(`/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/Many&offset=${offset}`)).json;
      expect(page).toMatchObject({ total: 75, offset, limit: 30 });
      expect(page.items).toHaveLength(offset === 60 ? 15 : 30);
      expect(page.nextOffset).toBe(offset === 60 ? undefined : offset + 30);
      pages.push(...page.items);
    }
    expect(new Set(pages.map(item => item.path)).size).toBe(75);
    expect((await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/Many&offset=999')).json).toMatchObject({ items: [], total: 75 });
    expect(fullCatalog).not.toHaveBeenCalled();
    expect(h.reads).toEqual([]);
    fullCatalog.mockRestore();
  });

  it('完整索引先搜索再按当前层分页，大小写与通配字符按字面匹配', async () => {
    const h = await setup();
    h.setPaths([...Array.from({ length: 40 }, (_, index) => `rule/Clash/Other/other-${index}.list`), 'rule/Clash/China/China.list', 'rule/Clash/China/100%_Target.list', 'rule/Clash/China/100XXTarget.list', 'rule/Clash/Other/ÄPFEL.txt']);
    await h.repos.refresh('blackmatrix7');
    for (const q of ['CHINA', 'china', 'ChInA']) {
      const result = (await h.admin.get(`/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/China&q=${q}`)).json;
      expect(result.items).toHaveLength(3);
    }
    const literal = (await h.admin.get(`/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/China&q=${encodeURIComponent('%_')}`)).json;
    expect(literal.items.map((node: { path: string }) => node.path)).toEqual(['rule/Clash/China/100%_Target.list']);
    const deep = (await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&q=äpfel')).json;
    expect(deep.items).toEqual([{ kind: 'directory', repo: 'blackmatrix7', name: 'rule', path: 'rule' }]);
    expect((await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/Other&q=äpfel')).json.items).toMatchObject([{ name: 'ÄPFEL.txt' }]);
    expect((await h.admin.get('/api/rule-options/catalog?q=GOOGLE')).json.items).toMatchObject([{ kind: 'local', id: 'local-google' }]);
    expect((await h.admin.get('/api/rule-options/catalog?q=not-found')).json).toMatchObject({ items: [], total: 0 });
    expect((await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/China&q=blackmatrix7')).json.total).toBe(3);
  });

  it('分页也适用于本地候选，隔离其他用户的规则并拒绝非法参数', async () => {
    const h = await setup();
    const local = h.store.get('ruleset', 'local-google')!;
    for (let i = 0; i < 65; i++) h.store.put('ruleset', { ...local, id: `local-${i}`, name: `候选 ${String(i).padStart(2, '0')}` }, h.user.id);
    const first = (await h.admin.get('/api/rule-options/catalog?q=候选')).json;
    expect(first).toMatchObject({ total: 65, nextOffset: 30 });
    expect(first.items).toHaveLength(30);
    expect((await h.admin.get('/api/rule-options/catalog?q=候选&offset=60')).json.items).toHaveLength(5);
    expect((await h.admin.get('/api/rule-options/catalog?q=私有')).json.total).toBe(0);
    for (const query of ['offset=-1', 'offset=1.2', 'offset=9007199254740992', 'limit=0', 'limit=101', 'limit=abc', 'directory=rule/Clash/China', 'repo=blackmatrix7&directory=../China', 'repo=blackmatrix7&directory=/China']) {
      expect((await h.admin.get(`/api/rule-options/catalog?${query}`)).status, query).toBe(400);
    }
  });

  it('旧目录缺失时仍分页提供已有文件，并提示索引未完整', async () => {
    const h = await setup();
    h.setPaths(Array.from({ length: 40 }, (_, i) => `rule/Clash/Many/file-${i}.list`));
    await h.repos.refresh('blackmatrix7');
    h.store.db.prepare('DELETE FROM rule_repo_catalog WHERE repo = ?').run('blackmatrix7');
    const page = (await h.admin.get('/api/rule-options/catalog?repo=blackmatrix7&directory=rule/Clash/Many')).json;
    expect(page).toMatchObject({ total: 40, nextOffset: 30 });
    expect(page.items).toHaveLength(30);
    expect(page.notices.join('')).toContain('完整目录索引待更新');
  });

  it('级联选中单文件仅保存该文件映射，模板与订阅可保存渲染，伪造文件被拒绝', async () => {
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
    const published = await h.admin.post('/api/templates/new/publish', { name: '级联文件模板', groups: [], rules, final: { kind: 'builtin', name: 'DIRECT' } });
    expect(published.status).toBe(201);
    const saved = await h.admin.post('/api/profiles', { name: '级联文件订阅', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: rules[0] }] } });
    expect(saved.status).toBe(201);
    expect((await h.renderer.preview(saved.json.item.id, { client: 'mihomo' })).ok).toBe(true);
    expect(h.store.list('ruleset')).toHaveLength(2);
  });

  it('缺少新目录缓存时降级标记并在相同提交下补建，失败保留旧完整清单', async () => {
    const h = await setup();
    const before = h.repos.catalog('blackmatrix7');
    h.store.db.prepare('DELETE FROM rule_repo_catalog WHERE repo=?').run('blackmatrix7');
    expect(h.repos.catalog('blackmatrix7').complete).toBe(false);
    await h.repos.refresh('blackmatrix7');
    expect(h.repos.catalog('blackmatrix7')).toEqual(before);
    h.store.db.exec("CREATE TRIGGER block_catalog BEFORE INSERT ON rule_repo_catalog BEGIN SELECT RAISE(ABORT, '模拟目录写入失败'); END");
    h.setPaths(['rule/Clash/new/new.list']);
    await h.repos.refresh('blackmatrix7');
    expect(h.repos.list().find(repo => repo.id === 'blackmatrix7')?.error).toContain('模拟目录写入失败');
    expect(h.repos.catalog('blackmatrix7')).toEqual(before);
    expect(h.repos.search('Google', 'blackmatrix7', undefined, 0, 10).total).toBe(1);
  });
});
