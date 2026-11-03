// 仅用于内置浏览器验收：内存数据库、虚构节点、无外部上游；Ctrl+C 后关闭全部连接。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';

const publicUrl = 'http://127.0.0.1:5197';
const store = new Store(':memory:');
const passwordHash = await hashPassword('share-test-2026');
const admin = store.createUser({ username: 'share-admin', passwordHash, role: 'admin' });
store.createUser({ username: 'share-reader', passwordHash, role: 'user' });
store.createUser({ username: 'share-other', passwordHash, role: 'user' });
store.db.prepare('UPDATE rule_repos SET enabled=0').run();
store.put('source', { id: 'airport', name: '机场 A', note: '管理员备注', url: 'https://airport.example.test/sub?key=secret', pipeline: [] }, admin.id);
const snapshots = new SnapshotService(store, async () => ({ status: 200, body: 'proxies: [{ name: 香港 01, type: socks5, server: hk.example.test, port: 1080 }, { name: 日本 03, type: socks5, server: jp.example.test, port: 1080 }]', userinfo: { upload: 0, download: 1073741824, total: 10737418240, expire: 2000000000 } }));
const renderer = new RenderService(store, snapshots);
const app = createApp({ store, snapshots, renderer, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5197 });
console.log(`隔离验收 ${publicUrl}；share-admin / share-reader / share-other；密码 share-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; store.closeEvents();
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
