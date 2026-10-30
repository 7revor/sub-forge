// 预览分栏验收：内存数据库与虚构数据，不访问实际订阅源。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { RenderService } from '../src/render.ts';
import type { ProfileDoc } from '../src/docs.ts';
import { addUser, setupApp } from './helpers.ts';

const env = setupApp({ now: () => Date.now() });
// 使用独立 localhost 域名，避免其他开发服务覆盖同名登录 Cookie。
const publicUrl = 'http://profile-preview.localhost:5276';
const user = await addUser(env.store, 'preview-admin', 'admin');
env.store.put('local', { id: 'nodes', name: '验收节点', proxies: Array.from({ length: 150 }, (_, i) => ({ name: `验收节点 ${i + 1}`, type: 'socks5', server: `node-${i + 1}.example.test`, port: 1080 })) }, user.id);
env.store.put('ruleset', { id: 'rules', name: '兼容性验收', sources: [{ id: 's', kind: 'local', format: 'classical', content: ['DOMAIN,example.test', ...Array.from({ length: 43 }, (_, i) => `USER-AGENT,Example${i}*`)].join('\n') }] }, user.id);
const profile: ProfileDoc = {
  id: 'long', name: '长配置与长报告', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'inline' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  routing: { mode: 'independent', config: {
    groups: Array.from({ length: 35 }, (_, i) => ({ id: `group-${i}`, name: `空策略组 ${i + 1}`, type: 'select', members: [] })),
    rules: [{ id: 'rules', matcher: { kind: 'ruleset', id: 'rules' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
  } },
};
env.store.put('profile', profile, user.id);
env.store.put('profile', { ...profile, id: 'short', name: '短配置与空报告', nodeSets: [], routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } }, user.id);
env.store.put('profile', { ...profile, id: 'failed', name: '渲染失败', routing: { mode: 'independent', config: { groups: [{ id: 'collision', name: '验收节点 1', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } }, user.id);
const renderer = new RenderService(env.store, env.snapshots, { publicUrl });
const app = createApp({ ...env, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5276 });
console.log(`隔离验收：${publicUrl}；账号 preview-admin，密码 password-123`);
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
