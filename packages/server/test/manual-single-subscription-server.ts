// 唯一链接浏览器验收：仅内存库和虚构节点，不连接实际订阅源。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { RenderService } from '../src/render.ts';
import { addUser, setupApp } from './helpers.ts';

const env = setupApp();
const publicUrl = 'http://127.0.0.1:5239';
const user = await addUser(env.store, 'link-admin', 'admin');
env.store.put('local', { id: 'demo-nodes', name: '验收节点', proxies: [{ name: '测试节点', type: 'socks5', server: 'node.example.test', port: 1080 }] }, user.id);
const renderer = new RenderService(env.store, env.snapshots, { publicUrl });
const app = createApp({ ...env, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5239 });
console.log(`隔离验收：${publicUrl}；账号 link-admin，密码 password-123`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.snapshots.settled();
  env.store.close();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
