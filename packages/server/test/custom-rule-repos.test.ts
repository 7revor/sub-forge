import { fixtureCache } from './repo-cache-fixture.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import { buildEntries } from '../src/rule-repos/adapters.ts';
import { parseCustomRepo, parseScans } from '../src/rule-repos/generic.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { createApp } from '../src/app.ts';
import { addUser, client, setupApp } from './helpers.ts';

const url = 'https://github.com/7revor/proxy-rules';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function setup() {
  let paths = ['ai.list', 'nested/ai.list', 'nested/ai.yaml', 'README.txt', 'script.js', 'data.mrs'];
  let body = 'DOMAIN,example.com\nAND,((DOMAIN,example.com),(DST-PORT,443))\nUNKNOWN,example.com';
  let revision = 'a'.repeat(40);
  let fail = false;
  const fetcher = vi.fn<UpstreamFetcher>(async target => {
    if (target.includes('/commits/')) {
      if (fail) throw new Error('测试网络故障');
      return { status: 200, body: JSON.stringify({ sha: revision, commit: { tree: { sha: 'b'.repeat(40) } } }) };
    }
    if (target.includes('/git/trees/')) return { status: 200, body: JSON.stringify({ truncated: false, tree: paths.map(path => ({ path, type: 'blob' })) }) };
    return { status: 200, body };
  });
  const env = setupApp({ fetcher });
  const cache = fixtureCache(fetcher);
  const service = new RuleRepoService(env.store, fetcher, Date.now, cache);
  const app = createApp({ ...env, ruleRepos: service });
  cleanups.push(async () => { await service.stop(); env.store.close(); });
  return { ...env, app, service, cache, fetcher, paths: (p: string[]) => { paths = p; revision = 'c'.repeat(40); }, body: (b: string) => { body = b; }, fail: () => { fail = true; } };
}

describe('自定义仓库配置与文件发现', () => {
  it('按完整路径保留不同目录和扩展名，以目录相对 glob 筛选', () => {
    const options = parseCustomRepo({ url, directory: 'rules/', include: ['**/*.list', '*.yaml'], exclude: ['skip/**'] });
    const entries = buildEntries({ id: 'custom', name: '自定义', owner: options.owner, repo: options.repo, refs: ['main'], license: '', scans: parseScans({ url, ...options, ref: 'main' }) }, { main: ['rules/a.list', 'rules/sub/a.list', 'rules/a.yaml', 'rules/skip/a.list', 'rules/README.list', 'rules/a.js', 'other/a.list'] });
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
    const current = h.service.definition(id); const def = { ...current, scans: undefined, adapter: 'generic', options: { ...current.scans[0], format: 'yaml' } };
    h.store.db.prepare('UPDATE rule_repos SET definition=? WHERE id=?').run(JSON.stringify(def),id);
    const restart = new RuleRepoService(h.store,h.fetcher, Date.now, fixtureCache(h.fetcher));
    expect(restart.definition(id).scans[0]!.format).toBe('auto');
    await restart.stop();
  });
  it('默认分支、规范 URL、持久配置与客户端筛选', async () => {
    const h = setup();
    const id = await h.service.addCustom({ url: url + '.git/' });
    await h.service.refresh(id);
    expect(h.service.list().find(r => r.id === id)).toMatchObject({ refs: ['main'], entries: 2 });
    expect(h.service.search('ai', id, 'surge', 0, 50).total).toBe(2);
    const restarted = new RuleRepoService(h.store, h.fetcher, Date.now, fixtureCache(h.fetcher));
    expect(restarted.definition(id).scans[0]?.format).toBe('auto');
    expect(restarted.search('', id, 'mihomo', 0, 50).total).toBe(2);
    await restarted.stop();
    await expect(h.service.addCustom({ url: 'https://github.com/7REVOR/PROXY-RULES' })).rejects.toMatchObject({ status: 409 });
  });
  it('Git 无法匿名读取或没有分支时拒绝添加，不写入无效配置', async () => {
    const h = setup();
    vi.mocked(h.cache.inspect).mockRejectedValueOnce(new Error('仓库不存在或需要认证'));
    await expect(h.service.addCustom({ url })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Git') });
    vi.mocked(h.cache.inspect).mockResolvedValueOnce({ branches: [] });
    await expect(h.service.addCustom({ url })).rejects.toMatchObject({ status: 400 });
    expect(h.service.list().filter(r => r.id.startsWith('custom-'))).toHaveLength(0);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('通过 Git 识别默认分支，校验每个显式分支，不依赖 HTTP 元数据', async () => {
    const h = setup();
    vi.mocked(h.cache.inspect).mockResolvedValue({ defaultBranch: 'release/2026', branches: ['release/2026', 'stable'] });
    const id = await h.service.addCustom({ url });
    expect(h.service.definition(id)).toMatchObject({ refs: ['release/2026'], license: '见上游仓库许可证' });
    expect(h.fetcher).not.toHaveBeenCalled();
    await expect(h.service.addCustom({ url, ref: 'missing' })).rejects.toMatchObject({ status: 400, message: '仓库分支不存在：missing' });
    vi.mocked(h.cache.inspect).mockResolvedValue({ branches: ['stable'] });
    await expect(h.service.addCustom({ url })).rejects.toThrow('请手动填写分支');
    const explicit = await h.service.addCustom({ url, ref: 'stable', license: '自定义许可证说明' });
    expect(h.service.definition(explicit).license).toBe('自定义许可证说明');
    const before = h.service.list().find(r => r.id === id)!;
    await expect(h.service.update(id, { ...before, scans: [{ ...before.scans[0], ref: 'stable' }, { ...before.scans[0], ref: 'missing' }] })).rejects.toThrow('分支不存在');
    expect(h.service.list().find(r => r.id === id)).toEqual(before);
    vi.mocked(h.cache.inspect).mockRejectedValueOnce(new Error('连接失败'));
    await expect(h.service.update(id, before)).rejects.toMatchObject({ status: 502 });
    expect(h.service.list().find(r => r.id === id)).toEqual(before);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('索引进行时不能删除，停用后无法搜索或导入', async () => {
    const h = setup(); const id = await h.service.addCustom({ url });
    const pending = h.service.refresh(id);
    await expect(h.service.removeCustom(id)).rejects.toThrow('索引正在更新');
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
  it('Git 缓存正文按实际格式识别，旧格式配置不阻止预览和单文件导入', async () => {
    const h = setup();
    h.body('payload:\n  - DOMAIN,example.com\n  - DOMAIN-SUFFIX,example.org\n');
    const id = await h.service.addCustom({ url, format: 'classical' });
    await h.service.refresh(id);
    expect(await h.service.detail(id, 'ai.list')).toMatchObject({ count: 2, rejected: 0 });
    const linked = await h.service.linkedFileSource(id, 'ai.list', { ref: 'main', path: 'ai.list' });
    expect(linked.sources[0]).toMatchObject({ url: 'https://raw.githubusercontent.com/7revor/proxy-rules/main/ai.list', repository: { repo: id, path: 'ai.list' } });
  });
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
    expect(detail).toMatchObject({ count: 2, rejected: 1, rejectedDetails: [expect.objectContaining({ line: 3 })] });
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
    expect((await admin.del('/api/rule-repos/blackmatrix7')).status).toBe(200);
    expect((await user.del(`/api/rule-repos/${id}`)).status).toBe(403);
    expect((await admin.del(`/api/rule-repos/${id}`)).status).toBe(200);
    expect(h.store.get('ruleset', target)?.sources).toHaveLength(1);
    expect((await user.put(`/api/rulesets/${target}`, { ...imported.json.item, note: '仓库删除后仍可编辑' })).status).toBe(200);
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(404);
  });
  it.each(['', '<html>错误页面</html>', 'payload: invalid', 'NOT,((DOMAIN,a),(DOMAIN,b))'])('无可解析内容不能导入：%s', async body => {
    const h = setup(); h.body(body);
    const id = await h.service.addCustom({ url }); await h.service.refresh(id);
    await addUser(h.store, 'alice'); const user = client(h.app); await user.login('alice');
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(400);
    expect((await user.post('/api/rule-repos/resolve', { repo: id, path: 'ai.list' })).status).toBe(400);
    h.body('DOMAIN,example.com');
    expect((await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' })).status).toBe(201);
  });
});

describe('动态仓库编辑与一致性', () => {
  it('两个默认仓库均可编辑和删除，重启不覆盖编辑或恢复已删除仓库', async () => {
    const h = setup();
    const original = h.service.list().find(r => r.id === 'blackmatrix7')!;
    const scans = [{ ...original.scans[0]!, ref: 'main', directory: 'nested', include: ['**/*.list'], exclude: [], groupBy: 'path', readme: false, format: 'auto' }];
    await h.service.update(original.id, { ...original, name: '修改后的仓库', url: 'https://github.com/example/new-rules', scans });
    await h.service.refresh(original.id);
    expect(h.service.fileList(original.id, 'nested/ai.list').files[0]?.url).toBe('https://raw.githubusercontent.com/example/new-rules/main/nested/ai.list');
    await h.service.removeCustom('zydou');
    const restarted = new RuleRepoService(h.store, h.fetcher, Date.now, fixtureCache(h.fetcher));
    expect(restarted.list().map(r => r.id)).toEqual(['blackmatrix7']);
    expect(restarted.definition(original.id)).toMatchObject({ name: '修改后的仓库', owner: 'example', refs: ['main'] });
    await restarted.stop();
  });
  it('编辑后同步失败保留旧配置和旧索引；重启后仍一致，成功后原子切换', async () => {
    const h = setup(); const id = await h.service.addCustom({ url }); await h.service.refresh(id);
    const old = h.service.fileList(id, 'ai.list');
    const before = h.service.list().find(r => r.id === id)!;
    await h.service.update(id, { ...before, url: 'https://github.com/example/new-rules', scans: [{ ...before.scans[0]!, directory: 'nested' }] });
    expect(h.service.list().find(r => r.id === id)?.pending).toBe(true);
    h.fail(); await h.service.refresh(id);
    expect(h.service.fileList(id, 'ai.list')).toEqual(old);
    const restart = new RuleRepoService(h.store, h.fetcher, Date.now, fixtureCache(h.fetcher));
    expect(restart.fileList(id, 'ai.list')).toEqual(old);
    expect(restart.list().find(r => r.id === id)?.pending).toBe(true);
    await restart.stop();
    h.fetcher.mockImplementation(async target => {
      if (target.includes('/commits/')) return { status: 200, body: JSON.stringify({ sha: 'c'.repeat(40), commit: { tree: { sha: 'd'.repeat(40) } } }) };
      return { status: 200, body: JSON.stringify({ tree: [{ path: 'nested/new.list', type: 'blob' }] }) };
    });
    await h.service.refresh(id);
    expect(h.service.list().find(r => r.id === id)?.pending).toBe(false);
    expect(h.service.search('', id, undefined, 0, 50).items.map(e => e.path)).toEqual(['nested/new.list']);
    expect(h.service.fileList(id, 'nested/new.list').files[0]?.url).toContain('/example/new-rules/');
  });
  it('仅修改扫描配置也会重建索引，旧编辑版本及重复仓库被拒绝', async () => {
    const h = setup(); const id = await h.service.addCustom({ url }); await h.service.refresh(id);
    const before = h.service.list().find(r => r.id === id)!;
    await h.service.update(id, { ...before, scans: [{ ...before.scans[0]!, directory: 'nested' }] });
    await h.service.refresh(id);
    expect(h.service.search('', id, undefined, 0, 50).items.map(e => e.path)).toEqual(['nested/ai.list']);
    await expect(h.service.update(id, before)).rejects.toMatchObject({ status: 409 });
    const current = h.service.list().find(r => r.id === id)!;
    await expect(h.service.update(id, { ...current, url: 'https://github.com/blackmatrix7/ios_rule_script', scans: [{ ...current.scans[0]!, ref: 'master' }] })).rejects.toMatchObject({ status: 409 });
    expect(h.service.list().find(r => r.id === id)?.url).toBe(url);
  });
  it('编辑接口权限、参数校验与停用仓库保存，既有来源保持可编辑', async () => {
    const h = setup(); const id = await h.service.addCustom({ url }); await h.service.refresh(id);
    await addUser(h.store, 'admin', 'admin'); await addUser(h.store, 'user');
    const admin = client(h.app); await admin.login('admin'); const user = client(h.app); await user.login('user');
    const before = h.service.list().find(r => r.id === id)!;
    expect((await user.put(`/api/rule-repos/${id}`, before)).status).toBe(403);
    const imported = await user.post('/api/rule-repos/import', { repo: id, path: 'ai.list' });
    for (const scans of [[], [{ ...before.scans[0], ref: '--upload-pack=evil' }], [{ ...before.scans[0], directory: '../bad' }]]) {
      expect((await admin.put(`/api/rule-repos/${id}`, { ...before, scans })).status).toBe(400);
    }
    h.service.setEnabled(id, false);
    expect((await admin.put(`/api/rule-repos/${id}`, { ...before, name: '已编辑' })).status).toBe(200);
    expect(h.service.list().find(r => r.id === id)).toMatchObject({ enabled: false, indexing: false, pending: true });
    expect((await user.put(`/api/rulesets/${imported.json.item.id}`, { ...imported.json.item, note: '修改备注' })).status).toBe(200);
    expect(h.store.get('ruleset', imported.json.item.id)?.sources[0]?.url).toBe(imported.json.item.sources[0].url);
  });
});

it('数据库写入失败回滚整个快照，恢复后可重新同步', async () => {
  const h = setup(); const id = await h.service.addCustom({ url }); await h.service.refresh(id);
  const before = h.service.search('', id, undefined, 0, 50);
  const revisions = h.service.list().find(r => r.id === id)!.revisions;
  h.store.db.exec("CREATE TRIGGER reject_new_entry BEFORE INSERT ON rule_repo_entries WHEN NEW.key = 'replacement.list' BEGIN SELECT RAISE(ABORT, '模拟事务写入失败'); END");
  h.paths(['replacement.list']); await h.service.refresh(id);
  expect(h.service.search('', id, undefined, 0, 50)).toEqual(before);
  expect(h.service.list().find(r => r.id === id)).toMatchObject({ revisions, error: expect.stringContaining('模拟事务写入失败') });
  h.store.db.exec('DROP TRIGGER reject_new_entry'); await h.service.refresh(id);
  expect(h.service.search('', id, undefined, 0, 50).items.map(e => e.path)).toEqual(['replacement.list']);
});
