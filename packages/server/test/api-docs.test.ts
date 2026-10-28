import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

const localSource = (name = '本地源') => ({ name, kind: 'local', content: 'trojan://pw@a.example.com:443#HK-01', pipeline: [] });

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
  it('未登录不能访问', async () => {
    const { app } = setupApp();
    expect((await client(app).get('/api/sources')).status).toBe(401);
  });

  it('创建由服务端生成 id；更新、读取、删除', async () => {
    const { alice } = await twoUsers();
    const created = await alice.post('/api/sources', localSource());
    expect(created.status).toBe(201);
    const id = created.json.item.id as string;
    expect(id).toMatch(/^[\w-]{12}$/);
    expect((await alice.put(`/api/sources/${id}`, { ...localSource('改名'), id })).json.item.name).toBe('改名');
    expect((await alice.put(`/api/sources/${id}`, { ...localSource(), id: 'other' })).status).toBe(400);
    expect((await alice.get(`/api/sources/${id}`)).json.item.name).toBe('改名');
    expect((await alice.get('/api/sources')).json.items).toHaveLength(1);
    expect((await alice.del(`/api/sources/${id}`)).status).toBe(200);
    expect((await alice.get(`/api/sources/${id}`)).status).toBe(404);
  });

  it('用户之间数据隔离：看不到、改不了、删不掉别人的文档', async () => {
    const { alice, bob } = await twoUsers();
    const id = (await alice.post('/api/sources', localSource())).json.item.id as string;
    expect((await bob.get('/api/sources')).json.items).toEqual([]);
    expect((await bob.get(`/api/sources/${id}`)).status).toBe(404);
    expect((await bob.put(`/api/sources/${id}`, localSource())).status).toBe(404);
    expect((await bob.del(`/api/sources/${id}`)).status).toBe(404);
    // 也不能在自己的组合里引用别人的订阅源
    const res = await bob.post('/api/collections', { name: 'C', members: [{ ref: { type: 'source', id } }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/不存在/);
  });

  it('保存前校验：必填项、正则、远程地址、脚本权限', async () => {
    const { alice } = await twoUsers();
    expect((await alice.post('/api/sources', { kind: 'local', content: '' })).json.error).toMatch(/name/);
    expect((await alice.post('/api/sources', { name: 'R', kind: 'remote', urls: ['file:///etc/passwd'] })).json.error).toMatch(/http/);
    const badRegex = await alice.post('/api/sources', { ...localSource(), pipeline: [{ op: 'filter.regex', patterns: ['(['], keep: true }] });
    expect(badRegex.status).toBe(400);
    expect(badRegex.json.error).toMatch(/第 1 步.*非法正则/);
    expect((await alice.post('/api/sources', { ...localSource(), pipeline: [{ op: 'script', code: 'x' }] })).json.error).toMatch(/脚本/);
    expect((await alice.post('/api/rulesets', { name: 'M', kind: 'remote', format: 'mrs', url: 'https://a.example.com/x.mrs' })).json.error).toMatch(/behavior/);
    expect((await alice.post('/api/bundles', { name: 'B', items: [{ kind: 'bundle', id: 'x' }] })).json.error).toMatch(/两层/);
  });

  it('组合成环时拒绝保存', async () => {
    const { alice } = await twoUsers();
    const s = (await alice.post('/api/sources', localSource())).json.item.id;
    const a = (await alice.post('/api/collections', { name: 'A', members: [{ ref: { type: 'source', id: s } }] })).json.item.id;
    const b = (await alice.post('/api/collections', { name: 'B', members: [{ ref: { type: 'collection', id: a } }] })).json.item.id;
    const res = await alice.put(`/api/collections/${a}`, { name: 'A', members: [{ ref: { type: 'collection', id: b } }] });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/成环/);
  });

  it('被引用的文档不能删除，返回引用方', async () => {
    const { alice } = await twoUsers();
    const s = (await alice.post('/api/sources', localSource())).json.item.id;
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
