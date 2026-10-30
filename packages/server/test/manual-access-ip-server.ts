// IP 日志浏览器验收：虚构文档、内存数据库，通过真实 HTTP 连接产生记录。
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { parseTrustedProxies } from '../src/net/client-ip.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';

const store = new Store(':memory:');
const user = store.createUser({ username: 'ip-admin', passwordHash: await hashPassword('ip-test-2026'), role: 'admin' });
const token = store.userToken(user.id)!.token;
store.put('local', { id: 'fixture', name: 'IP 透传验收节点', proxies: [] }, user.id);
const snapshots = new SnapshotService(store, async () => { throw new Error('验收不应访问上游'); });
const publicUrl = 'http://127.0.0.1:18743';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist'), trustedProxies: parseTrustedProxies('127.0.0.1,10.2.0.2') });
store.logAccess({ token, profileId: '', at: Date.now(), ua: '历史记录', client: 'mihomo', status: 200, ms: 1, warnings: 0, source: 'managed', kind: 'nodes', resourceName: '旧日志没有 IP' });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18743 });
if (!server.listening) await once(server, 'listening');
for (const xff of [undefined, '198.51.100.7', '2001:db8:1234:5678:90ab:cdef:1234:5678', '192.0.2.66, 198.51.100.8, 10.2.0.2', 'invalid']) {
  const response = await fetch(`${publicUrl}/subs/nodes?token=${token}&kind=local&id=fixture`, { headers: { 'user-agent': 'Mihomo/1.0', ...(xff ? { 'x-forwarded-for': xff } : {}) } });
  await response.text();
}
console.log(`隔离验收：${publicUrl}；账号 ip-admin，密码 ip-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled();
  store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
