// 内置浏览器验收专用：内存数据、虚构上游，只监听回环地址。
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { addUser, setupApp } from './helpers.ts';

const requests: { url: string; opts: unknown }[] = [];
let calls = 0;
const env = setupApp({ now: Date.now, fetcher: async (url, opts) => {
  requests.push({ url, opts });
  if (url.endsWith('/failed')) throw new Error('模拟上游不可用');
  calls++;
  if (calls === 3) throw new Error('模拟临时故障');
  return {
    status: 200,
    body: `trojan://fixture@node.example.test:443#测试节点-${calls}`,
    userinfo: { download: calls * 1024 ** 3, total: 150 * 1024 ** 3 },
  };
} });
const user = await addUser(env.store, 'source-admin', 'admin');
env.store.put('source', { id: 'source-fixture', name: '订阅源示例', url: 'https://fixture.example.test/sub', pipeline: [], fetch: { ttlSec: 86400 }, note: '内置浏览器验收数据' }, user.id);
await env.snapshots.refresh('source', 'source-fixture', 'https://fixture.example.test/sub');

const app = new Hono();
app.get('/__fixture', c => c.json({ requests, records: env.store.snapshotHistory('source', 'source-fixture') }));
app.route('/', createApp({ ...env, publicUrl: 'http://127.0.0.1:18879', webDir: resolve('../web/dist') }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18879 });
console.log('隔离验收：http://127.0.0.1:18879；账号 source-admin，密码 password-123');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.snapshots.settled();
  env.store.close();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  void stop().catch(error => { console.error(error); process.exitCode = 1; });
});
