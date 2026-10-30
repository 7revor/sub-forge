import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { randomBytes } from 'node:crypto';
import { Cipher } from '../src/crypto.ts';
import { remoteRuleMatcher } from '@sub-forge/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type UserAccessLogRow } from '../src/store.ts';
import { setupApp } from './helpers.ts';
import type { PageResult } from '../src/pagination.ts';
const pageJson = async (response: Response) => await response.json() as PageResult<UserAccessLogRow>;

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function setup(trustedProxies?: string) {
  const h = setupApp({ trustedProxies, fetcher: async url => ({ status: 200, body: url.endsWith('/nodes') ? 'proxies:\n  - {name: 示例节点, type: ss, server: example.test, port: 443, cipher: aes-128-gcm, password: fixture}' : 'DOMAIN,example.test' }) }); envs.push(h);
  const a = h.store.createUser({ username: '管理员', passwordHash: 'fixture', role: 'admin' });
  const b = h.store.createUser({ username: '普通用户', passwordHash: 'fixture', role: 'user' });
  const token = h.store.userToken(a.id)!.token, otherToken = h.store.userToken(b.id)!.token;
  const sessions = [a, b].map(u => h.store.createSession(u.id, 3600000));
  const api = (query = '', other = false) => h.app.request('/api/access-log' + query, { headers: { cookie: `sf_session=${sessions[other ? 1 : 0]}` } });
  const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
  h.store.importSeed({ sources: [{ id: 's', name: '机场节点', url: 'https://example.test/nodes', pipeline: [] }],
    locals: [{ id: 'l', name: '本地节点', proxies: [{ name: '本地', type: 'ss', server: 'example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture' }] }],
    collections: [{ id: 'c', name: '节点组合', members: [{ ref: { type: 'local', id: 'l' } }], pipeline: [] }],
    rulesets: [{ id: 'r', name: '公共增强集合', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,enhanced.test' }] }],
    profiles: [{ id: 'p', name: '我的配置', nodeSets: [{ ref: { type: 'local', id: 'l' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
      groups: [], rules: [{ id: 'rule', matcher: remoteRuleMatcher('https://rules.test/Apple.list'), target: direct }, { id: 'enhanced', matcher: { kind: 'ruleset', id: 'r' }, target: direct }], final: direct,
    } } }],
  }, a.id);
  return { ...h, a, b, token, otherToken, api };
}
async function rows(h: ReturnType<typeof setup>, other = false): Promise<UserAccessLogRow[]> { return (await pageJson(await h.api('', other))).items; }

it('默认包含四类访问，所有节点入口与 HEAD 只记录一次，参数错误也保留状态', async () => {
  const h = setup();
  const main = await h.app.request(`/sub/${h.token}/p`, { headers: { 'user-agent': 'ClashMetaForAndroid' } });
  const config = parse(await main.text());
  const urls = [Object.values<{ url: string }>(config['proxy-providers'])[0]!.url, ...Object.values<{ url: string }>(config['rule-providers']).map(r => r.url),
    `/rules/${h.token}/r`, `/nodes/${h.token}/source/s`, `/nodes/${h.token}/collection/c`, `/nodes/${h.token}/local/l`];
  for (const url of urls) expect((await h.app.request(url)).status).toBe(200);
  expect((await h.app.request(`/nodes/${h.token}/local/l`, { method: 'HEAD' })).status).toBe(200);
  for (const url of [`/sub/${h.token}/p`, `/nodes/${h.token}/local/l`, `/rules/${h.token}/r`]) expect((await h.app.request(url + '?target=bad')).status).toBe(400);
  const all = await rows(h);
  expect(all).toHaveLength(12);
  expect(new Set(all.map(r => r.kind))).toEqual(new Set(['subscription', 'nodes', 'rule-collection', 'enhancement']));
  expect(all.filter(r => r.method === 'HEAD')).toHaveLength(1);
  expect(all.filter(r => r.status === 400)).toHaveLength(3);
  expect(all.find(r => r.kind === 'subscription' && r.status === 200)).toMatchObject({ resourceName: '我的配置', client: 'mihomo', platform: 'android' });
  expect(JSON.stringify(all)).not.toContain(h.token);
  expect(all.every(row => !('token' in row))).toBe(true);
  expect(h.store.recentAccess('p')).toHaveLength(2);
});

it('公共资源按访问者 token 归属，管理员也只能查询自己；越权日志不暴露资源名', async () => {
  const h = setup();
  await h.app.request(`/rules/${h.otherToken}/r`);
  await h.app.request(`/nodes/${h.otherToken}/local/l`);
  await h.app.request(`/sub/${h.otherToken}/p`);
  expect(await rows(h)).toEqual([]);
  expect(await rows(h, true)).toMatchObject([
    { kind: 'subscription', status: 404, resourceName: '不可用资源', profileId: '' },
    { kind: 'nodes', status: 404, resourceName: '不可用资源', profileId: '' },
    { kind: 'enhancement', status: 200, resourceName: '公共增强集合' },
  ]);
  expect((await pageJson(await h.api('?userId=' + h.b.id))).total).toBe(0);
  expect((await h.app.request('/api/access-log')).status).toBe(401);
});

it('无效、禁用、重置前的 token 不记录；重置、删除资源后历史仍归原用户', async () => {
  const h = setup();
  await h.app.request(`/sub/${h.token}/p`);
  const next = h.store.resetToken(h.token)!.token;
  expect((await h.app.request(`/sub/${h.token}/p`)).status).toBe(404);
  await h.app.request('/sub/invalid/p');
  await h.app.request(`/sub/${next}/p`);
  h.store.updateUser(h.b.id, { disabled: true });
  await h.app.request(`/rules/${h.otherToken}/r`);
  h.store.delete('profile', 'p');
  expect(await rows(h)).toHaveLength(2);
  expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM access_log').get()).toEqual({ n: 2 });
});

it('服务端按类型分页且同时间排序稳定，拒绝非法筛选，日志保留期限生效', async () => {
  const h = setup();
  for (let i = 0; i < 24; i++) await h.app.request(`/nodes/${h.token}/local/l`);
  await h.app.request(`/rules/${h.token}/r`);
  const first = await pageJson(await h.api('?kind=nodes&page=1&pageSize=10'));
  const second = await pageJson(await h.api('?kind=nodes&page=2&pageSize=10'));
  expect(first).toMatchObject({ total: 24, page: 1, totalPages: 3 });
  expect(new Set([...first.items, ...second.items].map(r => r.id)).size).toBe(20);
  expect((await pageJson(await h.api('?kind=nodes&page=999&pageSize=10'))).page).toBe(3);
  expect((await pageJson(await h.api('?kind=subscription'))).items).toEqual([]);
  for (const query of ['?kind=foreign', '?page=0', '?pageSize=101']) expect((await h.api(query)).status).toBe(400);
  h.advance(31 * 86400_000);
  expect(h.store.userAccessPage(h.a.id, { page: 1, pageSize: 20, q: '' }).total).toBe(0);
  expect(h.store.pruneAccessLog()).toBe(25);
});

it('记录失败状态、处理耗时，并清理 UA 中的当前 token', async () => {
  const h = setup();
  h.store.put('source', { id: 'broken', name: '无效节点源', url: 'https://rules.test/fail.list', pipeline: [] }, h.a.id);
  expect((await h.app.request(`/nodes/${h.token}/source/broken`, { headers: { 'user-agent': 'Fixture ' + h.token } })).status).toBe(503);
  expect((await rows(h))[0]).toMatchObject({ kind: 'nodes', status: 503, source: 'failed', ua: 'Fixture [令牌]' });
  await h.app.request(`/sub/${h.token}/${h.token}`);
  expect(JSON.stringify(h.store.db.prepare('SELECT * FROM access_log').all())).not.toContain(h.token);
});

it('v23 日志迁移保留旧记录但不猜测 token 归属，重复启动保持新日志', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-access-log-')), path = join(dir, 'test.db');
  const cipher = new Cipher(randomBytes(32));
  let store = new Store(path, { cipher });
  try {
    const user = store.createUser({ username: '迁移用户', passwordHash: 'fixture', role: 'user' });
    const token = store.userToken(user.id)!.token;
    store.db.exec("DROP TABLE access_log; CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, profile_id TEXT NOT NULL, at INTEGER NOT NULL, ua TEXT NOT NULL, client TEXT NOT NULL, platform TEXT, status INTEGER NOT NULL, ms INTEGER NOT NULL, warnings INTEGER NOT NULL, source TEXT NOT NULL)");
    store.db.prepare('INSERT INTO access_log VALUES (1, ?, ?, ?, ?, ?, NULL, 200, 1, 0, ?)').run('oldhash', 'p', Date.now(), '旧客户端', 'mihomo', 'fresh');
    store.db.pragma('user_version = 23'); store.close(); store = new Store(path, { cipher });
    expect(store.recentAccess('p')).toHaveLength(1);
    expect(store.userAccessPage(user.id, { page: 1, pageSize: 20, q: '' }).total).toBe(0);
    store.logAccess({ token, profileId: 'p', at: Date.now(), ua: '', client: 'mihomo', status: 200, ms: 0, source: 'fresh', warnings: 0 });
    store.close(); store = new Store(path, { cipher });
    expect(store.userAccessPage(user.id, { page: 1, pageSize: 20, q: '' }).total).toBe(1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('请求等待期间重置令牌，不把旧请求归入新令牌的访问记录', async () => {
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const h = setupApp({ fetcher: async () => { entered(); await pending; return { status: 200, body: 'proxies: []' }; } }); envs.push(h);
  const user = h.store.createUser({ username: '并发用户', passwordHash: 'fixture', role: 'user' });
  const token = h.store.userToken(user.id)!.token;
  h.store.put('source', { id: 's', name: '等待的节点', url: 'https://example.test/nodes', pipeline: [] }, user.id);
  const response = h.app.request(`/nodes/${token}/source/s`);
  await ready; h.store.resetToken(token); release();
  expect((await response).status).toBe(404);
  expect(h.store.userAccessPage(user.id, { page: 1, pageSize: 20, q: '' }).total).toBe(0);
});


it.each([undefined, '127.0.0.1'])('真实 HTTP 连接记录 IP，透传信任配置：%s', async trustedProxies => {
  const h = setup(trustedProxies);
  const server = serve({ fetch: h.app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务没有 TCP 地址');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { 'x-forwarded-for': '192.0.2.99, 2001:db8::7', 'x-real-ip': '192.0.2.88', 'cf-connecting-ip': '192.0.2.77', forwarded: 'for=192.0.2.66' };
    for (const path of [`/sub/${h.token}/p`, `/nodes/${h.token}/local/l`, `/rules/${h.token}/r`, `/sub/${h.token}/p?target=bad`]) {
      const response = await fetch(base + path, { headers }); await response.text();
    }
    const result = await rows(h);
    expect(result).toHaveLength(4);
    for (const row of result) expect(row).toMatchObject({ clientIp: trustedProxies ? '2001:db8::7' : '127.0.0.1', peerIp: '127.0.0.1', ipSource: trustedProxies ? 'x-forwarded-for' : 'socket' });
    expect(h.store.recentAccess('p')[0]).toMatchObject({ clientIp: trustedProxies ? '2001:db8::7' : '127.0.0.1' });
    const response = await fetch(base + `/sub/${h.token}/p`, { method: 'HEAD', headers: { 'x-real-ip': '192.0.2.88', 'cf-connecting-ip': '192.0.2.77', forwarded: 'for=192.0.2.66' } });
    await response.text();
    expect((await rows(h))[0]).toMatchObject({ clientIp: '127.0.0.1', peerIp: '127.0.0.1', ipSource: 'socket', method: 'HEAD' });
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('v24 升级保留原日志，旧记录 IP 为空，新记录重启后仍保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-access-ip-')), path = join(dir, 'test.db');
  const cipher = new Cipher(randomBytes(32));
  let store = new Store(path, { cipher });
  try {
    const user = store.createUser({ username: '迁移用户', passwordHash: 'fixture', role: 'user' });
    const token = store.userToken(user.id)!.token;
    const record = { token, profileId: 'p', at: Date.now(), ua: '', client: 'mihomo', status: 200, ms: 0, source: 'fresh', warnings: 0 };
    store.logAccess(record);
    store.db.exec('ALTER TABLE access_log DROP COLUMN client_ip; ALTER TABLE access_log DROP COLUMN peer_ip; ALTER TABLE access_log DROP COLUMN ip_source');
    store.db.pragma('user_version = 24'); store.close(); store = new Store(path, { cipher });
    expect(store.recentAccess('p')[0]).toMatchObject({ clientIp: null, peerIp: null, ipSource: 'unknown' });
    store.logAccess({ ...record, clientIp: '2001:db8::9', peerIp: '10.2.0.2', ipSource: 'x-forwarded-for' });
    store.close(); store = new Store(path, { cipher });
    expect(store.db.pragma('user_version', { simple: true })).toBe(25);
    const result = store.userAccessPage(user.id, { page: 1, pageSize: 20, q: '' });
    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({ clientIp: '2001:db8::9', peerIp: '10.2.0.2', ipSource: 'x-forwarded-for' });
    expect(result.items[1]).toMatchObject({ clientIp: null, peerIp: null, ipSource: 'unknown' });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
