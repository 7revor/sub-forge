import { afterEach, describe, expect, it } from 'vitest';
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

  it('目录 API 只返回可见本地与启用仓库，索引刷新立即可读', async () => {
    const h = await setup();
    expect((await client(h.app).get('/api/rule-options/catalog')).status).toBe(401);
    expect((await h.admin.get('/api/rule-options/catalog?scope=bad')).status).toBe(400);
    const first = await h.admin.get('/api/rule-options/catalog');
    expect(first.json.locals.map((item: { id: string }) => item.id)).toEqual(['local-google']);
    expect(first.json.repositories).toHaveLength(1);
    expect(first.json.repositories[0].complete).toBe(true);
    expect((await h.admin.get('/api/rule-options/catalog?scope=repository')).json.locals).toEqual([]);
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list', 'rule/Clash/China/data.yaml']);
    await h.repos.refresh('blackmatrix7');
    const second = await h.admin.get('/api/rule-options/catalog');
    const files = second.json.repositories[0].nodes.filter((node: { kind: string }) => node.kind === 'file');
    expect(files).toHaveLength(3);
    expect(files.every((node: { path: string; entry: string }) => node.entry === 'China' && node.path.endsWith('.list'))).toBe(true);
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.get('/api/rule-options/catalog')).json.repositories).toEqual([]);
  });

  it('目录 LIKE 查询忽略大小写并覆盖完整清单，空格和通配符均按字面匹配', async () => {
    const h = await setup();
    h.setPaths([...Array.from({ length: 40 }, (_, index) => `rule/Clash/Other/other-${index}.list`), 'rule/Clash/China/China.list', 'rule/Clash/China/100%_Target.list', 'rule/Clash/China/100XXTarget.list', 'rule/Clash/Other/ÄPFEL.txt']);
    await h.repos.refresh('blackmatrix7');
    for (const q of ['CHINA', 'china', 'ChInA']) {
      const result = (await h.admin.get(`/api/rule-options/catalog?q=${q}`)).json;
      expect(result.repositories[0].nodes.filter((node: { kind: string }) => node.kind === 'file')).toHaveLength(3);
      expect(result.repositories[0].nodes.every((node: { path: string }) => node.path.includes('/China'))).toBe(true);
    }
    const literal = (await h.admin.get(`/api/rule-options/catalog?q=${encodeURIComponent('%_')}`)).json;
    expect(literal.repositories[0].nodes.map((node: { path: string }) => node.path)).toEqual(['rule/Clash/China/100%_Target.list']);
    expect(h.repos.search('%_', undefined, undefined, 0, 100).total).toBe(0);
    expect(h.repos.search('Other', undefined, undefined, 0, 100).total).toBe(1);
    expect(h.repos.catalog('blackmatrix7', 'äpfel').nodes.map(node => node.path)).toEqual(['rule/Clash/Other/ÄPFEL.txt']);
    expect((await h.admin.get('/api/rule-options/catalog?q=GOOGLE')).json.locals).toHaveLength(1);
    expect((await h.admin.get('/api/rule-options/catalog?q=not-found')).json).toMatchObject({ locals: [], repositories: [] });
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
