import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import { buildEntries } from '../src/rule-repos/adapters.ts';
import { parseCustomRepo } from '../src/rule-repos/generic.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { createApp } from '../src/app.ts';
import { addUser, client, setupApp } from './helpers.ts';

const url = 'https://github.com/7revor/proxy-rules';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function setup() {
  let paths = ['ai.list', 'nested/ai.list', 'nested/ai.yaml', 'README.txt', 'script.js', 'data.mrs'];
  let body = 'DOMAIN,example.com\nAND,((DOMAIN,example.com))';
  let revision = 'a'.repeat(40);
  let fail = false;
  const fetcher = vi.fn<UpstreamFetcher>(async target => {
    if (target.includes('/commits/')) {
      if (fail) throw new Error('测试网络故障');
      return { status: 200, body: JSON.stringify({ sha: revision, commit: { tree: { sha: 'b'.repeat(40) } } }) };
    }
    if (target.includes('/git/trees/')) return { status: 200, body: JSON.stringify({ truncated: false, tree: paths.map(path => ({ path, type: 'blob' })) }) };
    if (target.startsWith('https://api.github.com/repos/')) return { status: 200, body: JSON.stringify({ private: false, default_branch: 'main' }) };
    return { status: 200, body };
  });
  const env = setupApp({ fetcher });
  const service = new RuleRepoService(env.store, fetcher);
  const app = createApp({ ...env, ruleRepos: service });
  cleanups.push(async () => { await service.stop(); env.store.close(); });
  return { ...env, app, service, fetcher, paths: (p: string[]) => { paths = p; revision = 'c'.repeat(40); }, body: (b: string) => { body = b; }, fail: () => { fail = true; } };
}

describe('自定义仓库配置与文件发现', () => {
  it('按完整路径保留不同目录和扩展名，以目录相对 glob 筛选', () => {
    const options = parseCustomRepo({ url, directory: 'rules/', include: ['**/*.list', '*.yaml'], exclude: ['skip/**'] });
    const entries = buildEntries({ id: 'custom', name: '自定义', owner: options.owner, repo: options.repo, refs: ['main'], license: '', adapter: 'generic', options }, { main: ['rules/a.list', 'rules/sub/a.list', 'rules/a.yaml', 'rules/skip/a.list', 'rules/README.list', 'rules/a.js', 'other/a.list'] });
    expect(entries.map(e => e.path).sort()).toEqual(['rules/a.list', 'rules/sub/a.list']);
    expect(entries.every(e => e.variants.length === 1 && e.variants[0]?.files.length === 1)).toBe(true);
  });
  it.each([{ url: 'http://github.com/a/b' }, { url: 'https://evil.test/a/b' }, { url: url + '/tree/main' }, { url: 'https://user:pass@github.com/a/b' }, { directory: '/' }, { directory: '../a' }, { include: [' ../a'] }, { include: [] }, { include: ['[a].list'] }, { ref: '../main' }, { format: 'mrs' }, { format: 'yaml' }])('拒绝错误配置 %j', config => {
    expect(() => parseCustomRepo({ url, ...config })).toThrow();
  });
  it('宽泛 include 也不能索引 YAML/二进制，旧 YAML 仓库配置升级为自动识别', async () => {
    const h = setup(); const id = await h.service.addCustom({ url, include: ['**/*'] });
    h.paths(['a.list','a.txt','a.yaml','a.yml','a.mrs','a.srs','a.json']);
    await h.service.refresh(id);
    expect(h.service.search('',id,undefined,0,50).items.map(e=>e.path)).toEqual(['a.list','a.txt']);
    const def = h.service.definition(id); def.options!.format = 'yaml';
    h.store.db.prepare('UPDATE rule_repos SET definition=? WHERE id=?').run(JSON.stringify(def),id);
    const restart = new RuleRepoService(h.store,h.fetcher);
    expect(restart.definition(id).options!.format).toBe('auto');
    await restart.stop();
  });
  it('默认分支、规范 URL、持久配置与客户端筛选', async () => {
    const h = setup();
    const id = await h.service.addCustom({ url: url + '.git/' });
    await h.service.refresh(id);
    expect(h.service.list().find(r => r.id === id)).toMatchObject({ ref: 'main', entries: 2, builtIn: false });
    expect(h.service.search('ai', id, 'surge', 0, 50).total).toBe(2);
    const restarted = new RuleRepoService(h.store, h.fetcher);
    expect(restarted.definition(id).options?.format).toBe('auto');
    expect(restarted.search('', id, 'mihomo', 0, 50).total).toBe(2);
    await restarted.stop();
    await expect(h.service.addCustom({ url: 'https://github.com/7REVOR/PROXY-RULES' })).rejects.toMatchObject({ status: 409 });
  });
  it('拒绝私有或无效元数据，并报告 GitHub HTTP 错误', async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce({ status: 200, body: JSON.stringify({ private: true, default_branch: 'main' }) });
    await expect(h.service.addCustom({ url })).rejects.toMatchObject({ status: 400 });
    h.fetcher.mockResolvedValueOnce({ status: 404, body: '{}' });
    await expect(h.service.addCustom({ url })).rejects.toMatchObject({ status: 502 });
    expect(h.service.list().filter(r => !r.builtIn)).toHaveLength(0);
  });
  it('索引进行时不能删除，停用后无法搜索或导入', async () => {
    const h = setup(); const id = await h.service.addCustom({ url });
    const pending = h.service.refresh(id);
    expect(() => h.service.removeCustom(id)).toThrow('索引正在更新');
    await pending;
    h.service.setEnabled(id, false);
    expect(() => h.service.search('', id, undefined, 0, 50)).toThrow();
    await addUser(h.store, 'alice'); const user = client(h.app); await user.login('alice');
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(404);
  });
  it('失败保留索引，空匹配成功清空索引', async () => {
    const h = setup(); const id = await h.service.addCustom({ url });
    await h.service.refresh(id); h.fail(); await h.service.refresh(id);
    expect(h.service.search('', id, undefined, 0, 50).total).toBe(2);
    expect(h.service.list().find(r => r.id === id)?.error).toContain('测试网络故障');
    const other = setup(); const next = await other.service.addCustom({ url });
    await other.service.refresh(next); other.paths([]); await other.service.refresh(next);
    expect(other.service.list().find(r => r.id === next)).toMatchObject({ entries: 0, error: undefined });
  });
});

describe('自定义仓库管理及导入 API', () => {
  it('管理员添加、预览诊断、用户导入、追加去重，删除保留已导入来源', async () => {
    const h = setup();
    await addUser(h.store, 'admin', 'admin'); await addUser(h.store, 'alice');
    const admin = client(h.app); await admin.login('admin');
    const user = client(h.app); await user.login('alice');
    expect((await user.post('/api/rule-repos', { url })).status).toBe(403);
    const added = await admin.post('/api/rule-repos', { url });
    expect(added.status).toBe(201); const id = added.json.id;
    await h.service.refresh(id);
    const detail = await h.service.detail(id, 'ai.list');
    expect(detail).toMatchObject({ count: 1, rejected: 1, rejectedDetails: [expect.objectContaining({ line: 2 })] });
    const imported = await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' });
    expect(imported.status).toBe(201);
    expect(imported.json.item.sources[0]).toMatchObject({ kind: 'remote', format: 'auto', url: 'https://raw.githubusercontent.com/7revor/proxy-rules/main/ai.list' });
    expect(imported.json.item.sources[0].repository).toMatchObject({ repo: id, entry: 'ai.list', ref: 'main', path: 'ai.list' });
    const resolved = await user.post('/api/rule-repos/resolve', { repo: id, path: 'ai.list' });
    expect(resolved.status).toBe(200);
    expect((await user.post('/api/rulesets', { name: '自定义仓库关联', sources: resolved.json.sources })).status).toBe(201);
    expect((await user.post('/api/rulesets', { name: '伪造关联', sources: [{ ...resolved.json.sources[0], url: 'https://example.com/fake' }] })).status).toBe(400);
    const target = imported.json.item.id;
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list', ruleset: target })).json.item.sources).toHaveLength(1);
    expect((await admin.post('/api/rule-repos/import', { repo: id, path: 'ai.list', ruleset: target })).status).toBe(404);
    expect((await admin.del('/api/rule-repos/blackmatrix7')).status).toBe(400);
    expect((await user.del(`/api/rule-repos/${id}`)).status).toBe(403);
    expect((await admin.del(`/api/rule-repos/${id}`)).status).toBe(200);
    expect(h.store.get('ruleset', target)?.sources).toHaveLength(1);
    expect((await user.put(`/api/rulesets/${target}`, { ...imported.json.item, note: '仓库删除后仍可编辑' })).status).toBe(200);
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(404);
  });
  it.each(['', '<html>错误页面</html>', 'payload: invalid', 'AND,((DOMAIN,a))'])('无可解析内容不能导入：%s', async body => {
    const h = setup(); h.body(body);
    const id = await h.service.addCustom({ url }); await h.service.refresh(id);
    await addUser(h.store, 'alice'); const user = client(h.app); await user.login('alice');
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(400);
    expect((await user.post('/api/rule-repos/resolve', { repo: id, path: 'ai.list' })).status).toBe(400);
    h.body('DOMAIN,example.com');
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(201);
  });
});
