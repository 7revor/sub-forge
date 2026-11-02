// 公共 Clash 生成浏览器验收：仅内存数据库与固定虚构上游，退出时关闭服务和数据库。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { createApp } from '../src/app.ts';
import { RenderService } from '../src/render.ts';
import { addUser, setupApp } from './helpers.ts';

const publicUrl = 'http://127.0.0.1:5249';
const env = setupApp({ fetcher: async url => {
  if (url !== 'https://fixture.example.test/nodes') throw new Error('未声明的验收地址');
  return { status: 200, body: stringify({ proxies: ['香港验收节点', '日本验收节点'].map(name => ({ name, type: 'ss', server: 'node.example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture-password' })) }) };
} });
const user = await addUser(env.store, 'provider-admin', 'admin');
const ref = { type: 'source' as const, id: 'fixture-source' };
env.store.put('source', { id: ref.id, name: '花云（虚构验收）', url: 'https://fixture.example.test/nodes', pipeline: [] }, user.id);
env.store.put('local', { id: 'fixture-local', name: '本地落地', proxies: [{ name: 'vless-hk', type: 'vless', server: 'hk.example.test', port: 443, uuid: '00000000-0000-0000-0000-000000000001', tls: true }] }, user.id);
env.store.put('profile', { id: 'clash-common-profile', name: '公共 Clash 生成（验收样例）', nodeSets: [{ ref, output: 'provider' }, { ref: { type: 'local', id: 'fixture-local' }, output: 'inline' }],
  base: { kernels: { mihomo: 'mixed-port: 7890', stash: 'log-level: warning' } },
  chains: [
    { id: 'local-chain', landing: { nodeSet: { type: 'local', id: 'fixture-local' } }, via: { kind: 'group', groupId: 'upstream' } },
    { id: 'remote-chain', landing: { nodeSet: ref, filter: '日本' }, via: { kind: 'group', groupId: 'upstream' } },
  ],
  routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '科学上网', type: 'select', members: [{ kind: 'nodeset', ref }] }, { id: 'upstream', name: 'upstream-select', type: 'select', members: [{ kind: 'node', ref: { nodeSet: ref, match: { exact: '香港验收节点' } } }, { kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'group', groupId: 'g' } } },
}, user.id);
const renderer = new RenderService(env.store, env.snapshots, { publicUrl });
const app = createApp({ ...env, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5249 });
console.log(`隔离验收：${publicUrl}；账号 provider-admin，密码 password-123`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.snapshots.settled(); env.store.close();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
