import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

const remoteSource = (name = '远程源') => ({ name, urls: ['https://a.example.com/sub'], pipeline: [] });

async function twoUsers() {
  const env = setupApp();
  await addUser(env.store, 'root', 'admin');
  await addUser(env.store, 'alice');
  await addUser(env.store, 'bob');
  const admin = client(env.app);
  const alice = client(env.app);
  const bob = client(env.app);
  await admin.login('root');
  await alice.login('alice');
  await bob.login('bob');
  return { ...env, admin, alice, bob };
}

describe('文档增删改查', () => {
  it('旧模板版本依赖的规则不可删除，锁定旧版本的 Profile 继续可渲染', async () => {
    const { store, renderer, admin, alice } = await twoUsers();
    const rs = (await admin.post('/api/rulesets', { name: '旧规则', kind: 'local', format: 'classical', content: 'DOMAIN,example.test' })).json.item.id;
    const t = { id: 'legacy', version: 1, name: '历史模板', groups: [], rules: [{ id: 'r', matcher: { kind: 'ruleset' as const, id: rs }, target: { kind: 'builtin' as const, name: 'DIRECT' as const } }], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
    store.putTemplateVersion(t); store.putTemplateVersion({ ...t, version: 2, rules: [] });
    const p = (await alice.post('/api/profiles', { name: '锁定旧版', nodeSets: [], template: { id: t.id, follow: { pinned: 1 } } })).json.item.id;
    const res = await admin.del(`/api/rulesets/${rs}`);
    expect(res.status).toBe(409);
    expect(res.json.details.referrers).toContain('模板「历史模板」v1');
    expect((await renderer.preview(p, { client: 'mihomo' })).ok).toBe(true);
  });

  it('不同属性顺序的引用与跨用户共享规则也阻止删除，不暴露他人配置名称', async () => {
    const { admin, alice } = await twoUsers();
    const rs = (await admin.post('/api/rulesets', { name: '公共规则', kind: 'local', format: 'classical', content: 'DOMAIN,example.test' })).json.item.id;
    await alice.post('/api/profiles', { name: '不对管理员暴露的名称', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { id: rs, kind: 'ruleset' }, target: { kind: 'builtin', name: 'DIRECT' } } }] } });
    const res = await admin.del(`/api/rulesets/${rs}`);
    expect(res.status).toBe(409);
    expect(res.json.details.referrers).toEqual(['其他用户的配置订阅']);
  });
  it('未登录不能访问', async () => {
    const { app } = setupApp();
    expect((await client(app).get('/api/sources')).status).toBe(401);
  });

  it('创建由服务端生成 id；更新、读取、删除', async () => {
    const { alice } = await twoUsers();
    const created = await alice.post('/api/sources', remoteSource());
    expect(created.status).toBe(201);
    const id = created.json.item.id as string;
    expect(id).toMatch(/^[\w-]{12}$/);
    expect((await alice.put(`/api/sources/${id}`, { ...remoteSource('改名'), id })).json.item.name).toBe('改名');
    expect((await alice.put(`/api/sources/${id}`, { ...remoteSource(), id: 'other' })).status).toBe(400);
    expect((await alice.get(`/api/sources/${id}`)).json.item.name).toBe('改名');
    expect((await alice.get('/api/sources')).json.items).toHaveLength(1);
    expect((await alice.del(`/api/sources/${id}`)).status).toBe(200);
    expect((await alice.get(`/api/sources/${id}`)).status).toBe(404);
  });

  it('用户之间数据隔离：看不到、改不了、删不掉别人的文档', async () => {
    const { alice, bob } = await twoUsers();
    const id = (await alice.post('/api/sources', remoteSource())).json.item.id as string;
    expect((await bob.get('/api/sources')).json.items).toEqual([]);
    expect((await bob.get(`/api/sources/${id}`)).status).toBe(404);
    expect((await bob.put(`/api/sources/${id}`, remoteSource())).status).toBe(404);
    expect((await bob.del(`/api/sources/${id}`)).status).toBe(404);
    // 也不能在自己的组合里引用别人的订阅源
    const res = await bob.post('/api/collections', { name: 'C', members: [{ ref: { type: 'source', id } }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/不存在/);
  });

  it('保存前校验：必填项、正则、远程地址、脚本权限', async () => {
    const { alice } = await twoUsers();
    expect((await alice.post('/api/sources', { urls: ['https://a.example.com/sub'] })).json.error).toMatch(/name/);
    expect((await alice.post('/api/sources', { name: 'L', kind: 'local', content: 'x' })).json.error).toMatch(/本地节点组/);
    expect((await alice.post('/api/sources', { ...remoteSource(), content: 'x' })).json.error).toMatch(/本地节点组/);
    expect((await alice.post('/api/sources', { name: 'R', kind: 'remote', urls: ['https://a.example.com/sub'] })).json.item).not.toHaveProperty('kind');
    expect((await alice.post('/api/sources', { name: 'R', urls: ['file:///etc/passwd'] })).json.error).toMatch(/http/);
    const badRegex = await alice.post('/api/sources', { ...remoteSource(), pipeline: [{ op: 'filter.regex', patterns: ['(['], keep: true }] });
    expect(badRegex.status).toBe(400);
    expect(badRegex.json.error).toMatch(/第 1 步.*非法正则/);
    expect((await alice.post('/api/sources', { ...remoteSource(), pipeline: [{ op: 'script', code: 'x' }] })).json.error).toMatch(/脚本/);
    expect((await alice.post('/api/rulesets', { name: 'M', kind: 'remote', format: 'mrs', url: 'https://a.example.com/x.mrs' })).json.error).toMatch(/behavior/);
    expect((await alice.post('/api/bundles', { name: 'B', items: [{ kind: 'bundle', id: 'x' }] })).json.error).toMatch(/两层/);
  });

  it('组合成环时拒绝保存', async () => {
    const { alice } = await twoUsers();
    const s = (await alice.post('/api/sources', remoteSource())).json.item.id;
    const a = (await alice.post('/api/collections', { name: 'A', members: [{ ref: { type: 'source', id: s } }] })).json.item.id;
    const b = (await alice.post('/api/collections', { name: 'B', members: [{ ref: { type: 'collection', id: a } }] })).json.item.id;
    const res = await alice.put(`/api/collections/${a}`, { name: 'A', members: [{ ref: { type: 'collection', id: b } }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/成环/);
  });

  it('本地节点草稿缺少必填项时拒绝保存，补齐后可保存', async () => {
    const { store, alice } = await twoUsers();
    const proxy = { name: '节点 1', type: 'vless', server: 'node.example.test', port: 443, uuid: 'test-uuid' };
    for (const patch of [{ name: '' }, { type: '' }, { server: '' }, { port: 0 }]) {
      const res = await alice.post('/api/locals', { name: '未完成分组', proxies: [{ ...proxy, ...patch }] });
      expect(res.status).toBe(400);
      expect(res.json.error).toContain('节点 1 缺少');
    }
    expect(store.list('local')).toEqual([]);
    const saved = await alice.post('/api/locals', { name: '完整分组', proxies: [proxy] });
    expect(saved.status).toBe(201);
    expect(saved.json.item.proxies).toEqual([proxy]);
  });

  it('本地节点不处理代理链：带前置字段时拒绝保存', async () => {
    const { store, alice } = await twoUsers();
    const proxy = { name: '节点 1', type: 'trojan', server: 'node.example.test', port: 443, password: 'p' };
    for (const patch of [{ dialer: { kind: 'builtin', name: 'DIRECT' } }, { 'dialer-proxy': '中转' }, { 'underlying-proxy': '中转' }]) {
      const res = await alice.post('/api/locals', { name: '分组', proxies: [{ ...proxy, ...patch }] });
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/代理链/);
    }
    expect(store.list('local')).toEqual([]);
  });

  it('被引用的文档不能删除，返回引用方', async () => {
    const { alice } = await twoUsers();
    const s = (await alice.post('/api/sources', remoteSource())).json.item.id;
    await alice.post('/api/collections', { name: '全部', members: [{ ref: { type: 'source', id: s } }] });
    await alice.post('/api/profiles', { name: '订阅', nodeSets: [{ ref: { type: 'source', id: s }, output: 'provider' }] });
    const res = await alice.del(`/api/sources/${s}`);
    expect(res.status).toBe(409);
    expect(res.json.details.referrers).toEqual(['组合「全部」', '配置订阅「订阅」']);
  });

  it('Profile 补全默认字段，模板与预设必须存在', async () => {
    const { alice } = await twoUsers();
    const res = await alice.post('/api/profiles', { name: 'P', nodeSets: [] });
    expect(res.json.item).toMatchObject({ overlay: {}, chains: [], refPolicy: { default: 'wrap' } });
    expect((await alice.post('/api/profiles', { name: 'P', nodeSets: [], template: { id: 'nope', follow: 'latest' } })).json.error).toMatch(/模板不存在/);
    expect((await alice.post('/api/profiles', { name: 'P', nodeSets: [], base: { presetId: 'nope' } })).json.error).toMatch(/预设不存在/);
  });

  it('基础设置预设：管理员维护，所有人可读', async () => {
    const { admin, alice } = await twoUsers();
    expect((await alice.post('/api/presets', { name: 'X', mihomo: {} })).status).toBe(403);
    const id = (await admin.post('/api/presets', { name: 'fake-ip', mihomo: { 'mixed-port': 7890 } })).json.item.id;
    expect((await alice.get('/api/presets')).json.items.map((p: { name: string }) => p.name)).toEqual(['fake-ip']);
    expect((await alice.get(`/api/presets/${id}`)).status).toBe(200);
    await alice.post('/api/profiles', { name: 'P', nodeSets: [], base: { presetId: id } });
    expect((await admin.del(`/api/presets/${id}`)).status).toBe(409);
  });
});

describe('预设 Surge 预留字段', () => {
  it('保存和更新后可完整读回，允许 general 中的任意值及空段', async () => {
    const { admin, alice } = await twoUsers();
    const surge = { general: { ipv6: true, 'dns-server': ['1.1.1.1'], extra: { nested: null } }, host: { 'example.com': '1.2.3.4' } };
    const created = await admin.post('/api/presets', { name: '双客户端', mihomo: {}, surge });
    expect(created.status).toBe(201);
    const path = `/api/presets/${created.json.item.id}`;
    expect((await alice.get(path)).json.item.surge).toEqual(surge);
    const updated = await admin.put(path, { name: '空段', mihomo: {}, surge: {} });
    expect(updated.status).toBe(200);
    expect((await alice.get(path)).json.item.surge).toEqual({});
  });

  it.each([1, null, [], { general: 1 }, { general: null }, { general: [] }, { host: 1 }, { host: null }, { host: [] }, { host: { a: 1 } }])('非法 Surge 类型 %j 返回 400', async (surge) => {
    const { admin } = await twoUsers();
    const res = await admin.post('/api/presets', { name: '非法预设', mihomo: {}, surge });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/surge.*必须是/);
  });
});

describe('拉取参数校验', () => {
  it('快照有效期不能短于 5 分钟', async () => {
    const { alice } = await twoUsers();
    const src = { name: '远程源', urls: ['https://example.com/sub'] };
    const short = await alice.post('/api/sources', { ...src, fetch: { ttlSec: 60 } });
    expect(short.status).toBe(400);
    expect(short.json.error).toMatch(/快照有效期不能短于 5 分钟/);
    expect((await alice.post('/api/sources', { ...src, fetch: { ttlSec: 300 } })).status).toBe(201);
    const rs = await alice.post('/api/rulesets', { name: '远程规则', kind: 'remote', format: 'classical', url: 'https://example.com/r.list', fetch: { ttlSec: 0 } });
    expect(rs.status).toBe(400);
  });
});
