import { afterEach, describe, expect, it } from 'vitest';
import { addUser, client, independentRouting, setupApp } from './helpers.ts';

const URL_SECRET = 'https://airport.secret.test/sub?key=upstream-secret';
const BODY = 'proxies: [{name: 香港 01, type: socks5, server: node.test, port: 1080}]';
const active: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of active.splice(0)) { await h.snapshots.settled(); h.store.close(); } });

async function setup() {
  let fail = false;
  const h = setupApp({ fetcher: async () => {
    if (fail) throw new Error('getaddrinfo ENOTFOUND airport.secret.test');
    return { status: 200, body: BODY, userinfo: { download: 1, total: 10 } };
  } });
  active.push(h);
  const adminUser = await addUser(h.store, 'root', 'admin');
  const bobUser = await addUser(h.store, 'bob');
  const carolUser = await addUser(h.store, 'carol');
  const admin = client(h.app), bob = client(h.app), carol = client(h.app);
  await admin.login('root'); await bob.login('bob'); await carol.login('carol');
  const source = (await admin.post('/api/sources', { name: '机场 A', note: '管理员备注', url: URL_SECRET, pipeline: [{ op: 'filter.regex', patterns: ['香港'], keep: true }] })).json.item;
  return { ...h, admin, bob, carol, adminUser, bobUser, carolUser, source, setFail: (value: boolean) => { fail = value; } };
}

const profile = (sourceId: string) => ({ name: '我的订阅', nodeSets: [{ ref: { type: 'source', id: sourceId }, output: 'inline' }], chains: [], routing: independentRouting() });

describe('节点订阅分享', () => {
  it('只有管理员能分享，且只能分享自己的订阅源', async () => {
    const { admin, bob, bobUser, adminUser, source } = await setup();
    expect((await bob.get('/api/shares')).status).toBe(403);
    expect((await bob.put(`/api/shares/${source.id}`, { to: [bobUser.id] })).status).toBe(403);
    expect((await admin.put('/api/shares/missing', { to: [bobUser.id] })).status).toBe(404);
    expect((await admin.put(`/api/shares/${source.id}`, { to: [adminUser.id] })).status).toBe(400);
    expect((await admin.put(`/api/shares/${source.id}`, { to: ['nobody'] })).status).toBe(400);
    expect((await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] })).status).toBe(200);
    expect((await admin.get('/api/shares')).json.items).toEqual([{ id: source.id, name: '机场 A', to: [bobUser.id] }]);
  });

  it('接收者只读：看不到地址、处理链、备注，也不能修改、删除或刷新', async () => {
    const { admin, bob, carol, bobUser, source } = await setup();
    await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] });

    const expected = { id: source.id, name: '机场 A', url: '', pipeline: [], sharedBy: 'root' };
    expect((await bob.get('/api/sources')).json).toMatchObject({ items: [expected], writableIds: [] });
    expect((await bob.get('/api/sources?page=1&pageSize=10&q=')).json).toMatchObject({ items: [expected], total: 1, writableIds: [] });
    expect((await bob.get(`/api/sources?id=${source.id}`)).json).toMatchObject({ item: expected, writable: false });
    expect((await admin.get('/api/sources')).json.writableIds).toEqual([source.id]);
    // 未被分享的用户仍然完全不可见
    expect((await carol.get('/api/sources')).json.items).toEqual([]);
    expect((await carol.get(`/api/sources?id=${source.id}`)).status).toBe(404);
    expect((await carol.get(`/api/nodesets/nodes?type=source&id=${source.id}`)).status).toBe(404);

    expect((await bob.put(`/api/sources/${source.id}`, { name: '改名', url: 'https://x.test/' })).status).toBe(404);
    expect((await bob.del(`/api/sources/${source.id}`)).status).toBe(404);
    expect((await bob.post(`/api/sources/${source.id}/refresh`)).status).toBe(404);
    expect((await bob.post(`/api/sources/${source.id}/refresh-cache`)).status).toBe(404);
    expect((await bob.post(`/api/sources/${source.id}/pipeline-preview`, {})).status).toBe(404);
  });

  it('接收者可以查看节点并在配置订阅、组合中引用，节点随分享者更新', async () => {
    const { admin, bob, store, bobUser, source } = await setup();
    const denied = await bob.post('/api/profiles', profile(source.id));
    expect(denied.status).toBe(400);
    await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] });

    const nodes = await bob.get(`/api/nodesets/nodes?type=source&id=${source.id}`);
    expect(nodes.json.nodes.map((n: { name: string }) => n.name)).toEqual(['香港 01']);

    const collection = await bob.post('/api/collections', { name: '组合', members: [{ ref: { type: 'source', id: source.id } }], pipeline: [] });
    expect(collection.status).toBe(201);
    const saved = await bob.post('/api/profiles', profile(source.id));
    expect(saved.status).toBe(201);

    const token = store.createToken(bobUser.id).token;
    const sub = await bob.get(`/subs/profile?id=${saved.json.item.id}&token=${token}&target=mihomo`);
    expect(sub.status).toBe(200);
    expect(sub.text).toContain('香港 01');
    expect(sub.text).not.toContain('airport.secret.test');

    const direct = await bob.get(`/subs/nodes?kind=source&id=${source.id}&token=${token}&target=mihomo`);
    expect(direct.status).toBe(200);
    expect(direct.text).toContain('香港 01');
    expect((await bob.get(`/api/resource-links?kind=sources&id=${source.id}`)).status).toBe(200);
  });

  it('上游错误详情只有分享者可见', async () => {
    const { admin, bob, bobUser, source, setFail, snapshots } = await setup();
    await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] });
    setFail(true);
    await admin.post(`/api/sources/${source.id}/refresh`);
    await snapshots.settled();

    expect(JSON.stringify((await admin.get(`/api/sources/cache?id=${source.id}`)).json)).toContain('airport.secret.test');
    const saved = (await bob.post('/api/profiles', profile(source.id))).json.item;
    const responses = await Promise.all([
      bob.get(`/api/sources?id=${source.id}`),
      bob.get('/api/sources'),
      bob.get(`/api/sources/snapshots?id=${source.id}`),
      bob.get(`/api/sources/cache?id=${source.id}`),
      bob.get(`/api/profiles/cache?id=${saved.id}`),
      bob.get(`/api/nodesets/nodes?type=source&id=${source.id}`),
      bob.post(`/api/profiles/${saved.id}/preview`, { client: 'mihomo' }),
    ]);
    for (const res of responses) expect(res.text).not.toMatch(/airport\.secret|upstream-secret|管理员备注/);
    expect((await bob.get(`/api/sources/cache?id=${source.id}`)).json.items[0].error).toBe('上游拉取失败，详情仅分享者可见');

    const started = (await bob.post(`/api/profiles/${saved.id}/refresh-cache`)).json.job;
    await snapshots.settled();
    let job = started;
    for (let i = 0; i < 50 && job.state === 'running'; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      job = (await bob.get(`/api/refresh-jobs?id=${started.id}`)).json.job;
    }
    expect(JSON.stringify(job)).not.toContain('airport.secret');
  });

  it('取消分享立即生效：接收者不再可读，已有引用停止下发，保存时要求移除', async () => {
    const { admin, bob, store, bobUser, source } = await setup();
    await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] });
    const saved = (await bob.post('/api/profiles', profile(source.id))).json.item;
    const token = store.createToken(bobUser.id).token;
    expect((await bob.get(`/subs/profile?id=${saved.id}&token=${token}&target=mihomo`)).status).toBe(200);

    expect((await admin.put(`/api/shares/${source.id}`, { to: [] })).status).toBe(200);
    expect((await admin.get('/api/shares')).json.items).toEqual([]);
    expect((await bob.get('/api/sources')).json.items).toEqual([]);
    expect((await bob.get(`/subs/nodes?kind=source&id=${source.id}&token=${token}`)).status).toBe(404);
    expect((await bob.get(`/subs/profile?id=${saved.id}&token=${token}&target=mihomo`)).text).not.toContain('香港 01');
    expect((await bob.put(`/api/profiles/${saved.id}`, profile(source.id))).status).toBe(400);
  });

  it('删除订阅源同时清除分享；组合和本地节点组不能通过分享读取', async () => {
    const { admin, bob, store, bobUser, source } = await setup();
    const collection = (await admin.post('/api/collections', { name: '管理员组合', members: [{ ref: { type: 'source', id: source.id } }], pipeline: [] })).json.item;
    await admin.put(`/api/shares/${source.id}`, { to: [bobUser.id] });
    expect((await bob.get(`/api/nodesets/nodes?type=collection&id=${collection.id}`)).status).toBe(404);
    expect((await bob.post('/api/profiles', { ...profile(source.id), nodeSets: [{ ref: { type: 'collection', id: collection.id }, output: 'inline' }] })).status).toBe(400);
    await admin.del(`/api/collections/${collection.id}`);
    expect((await admin.del(`/api/sources/${source.id}`)).status).toBe(200);
    expect(store.isSourceSharedWith(source.id, bobUser.id)).toBe(false);
    expect((await admin.get('/api/shares')).json.items).toEqual([]);
  });
});
