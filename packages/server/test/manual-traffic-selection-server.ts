// 内置浏览器隔离验收：仅使用虚构节点、固定流量与内存数据库。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';

const store = new Store(':memory:');
const user = store.createUser({ username: 'traffic-demo', passwordHash: await hashPassword('traffic-demo-2026'), role: 'admin' });
for (const [id, name] of [['a', '花云 · 主力订阅'], ['b', '备用订阅'], ['c', '长期订阅']] as const) {
  store.put('source', { id, name, url: `https://subscription.example.test/${id}`, pipeline: [] }, user.id);
}
store.put('profile', {
  id: 'traffic-demo', name: '极简', nodeSets: [{ ref: { type: 'source', id: 'a' }, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  base: { enabled: true, kernels: { mihomo: 'mixed-port: 7890\ndns:\n  enable: true\n  nameserver:\n    - 223.5.5.5\n', surge: '[General]\ndns-server = 223.5.5.5\n' } },
  routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } },
}, user.id);
store.putToken({ token: 'traffic-demo-token', userId: user.id });
const snapshots = new SnapshotService(store, async url => {
  const id = new URL(url).pathname.slice(1);
  if (!['a', 'b', 'c'].includes(id)) throw new Error('验收禁止访问未知上游');
  return { status: 200, body: `trojan://example@${id}.example.test:443#演示节点-${id}`, userinfo: {
    upload: 0, download: id === 'a' ? 10 : id === 'b' ? 20 : 30, total: 1000, expire: id === 'b' ? 1900000000 : 2000000000,
  } };
});
const publicUrl = 'http://127.0.0.1:5199';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5199 });
console.log(`隔离验收：${publicUrl}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
