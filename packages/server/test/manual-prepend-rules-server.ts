// 内置浏览器验收：仅回环地址、内存数据库、虚构节点与本地模拟上游。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';

const store = new Store(':memory:');
const user = store.createUser({ username: 'prepend-admin', passwordHash: await hashPassword('prepend-test-2026'), role: 'admin' });
store.put('source', { id: 'remote', name: '远端 provider', url: 'https://nodes.example.test/sub', pipeline: [] }, user.id);
store.putTemplateVersion({ id: 'template', name: '前置规则验收模板', version: 1, groups: [
  { id: 'default', name: '默认策略组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] },
  { id: 'auto', name: '自动选择', type: 'url-test', members: [{ kind: 'group', groupId: 'default' }], test: { interval: 300 } },
], rules: [{ id: 'template-rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.test' } }, target: { kind: 'group', groupId: 'default' } }], final: { kind: 'group', groupId: 'auto' } });
store.put('profile', { id: 'bound', name: '绑定订阅·前置规则验收', nodeSets: [{ ref: { type: 'source', id: 'remote' }, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  routing: { mode: 'bound', templateId: 'template', groupAdditions: { default: [{ kind: 'nodeset', ref: { type: 'source', id: 'remote' } }] } },
}, user.id);
const snapshots = new SnapshotService(store, async () => ({ status: 200, body: 'proxies:\n- { name: 远端香港节点, type: socks5, server: hk.example.test, port: 1080 }\n- { name: 远端日本节点, type: socks5, server: jp.example.test, port: 1080 }\n' }));
const publicUrl = 'http://127.0.0.1:5196';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5196 });
console.log(`隔离验收：${publicUrl}；账号 prepend-admin，密码 prepend-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
