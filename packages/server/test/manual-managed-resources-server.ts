// 仅用于内置浏览器验收：内存数据库、虚构节点、无外部上游；Ctrl+C 后关闭全部连接。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { remoteRuleMatcher } from '@sub-forge/core';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
const store = new Store(':memory:');
const passwordHash = await hashPassword('managed-test-2026');
const admin = store.createUser({ username: 'managed-admin', passwordHash, role: 'admin' });
const reader = store.createUser({ username: 'managed-reader', passwordHash, role: 'user' });
store.db.prepare('UPDATE rule_repos SET enabled=0').run();
store.put('local', { id: 'nodes', name: '验收节点', proxies: [{ name: '落地节点', type: 'socks5', server: 'example.test', port: 1080 }] }, admin.id);
store.put('source', { id: 'source', name: '流量验收节点源', url: 'https://nodes.example.test/sub', pipeline: [] }, admin.id);
store.put('collection', { id: 'collection', name: '验收节点组合', members: [{ ref: { type: 'source', id: 'source' } }, { ref: { type: 'local', id: 'nodes' } }], pipeline: [] }, admin.id);
store.put('local', { id: 'reader-nodes', name: '读者私有节点', proxies: [{ name: '读者节点', type: 'socks5', server: 'reader.example.test', port: 1080 }] }, reader.id);
store.put('ruleset', { id: 'shared', name: '公共规则增强', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,example.test' }] }, admin.id);
for (const id of ['first', 'second', 'unused']) store.put('profile', { id, name: id === 'unused' ? '临时配置' : `托管验收·${id}`, nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [{ id: 'chain', landing: { nodeSet: { type: 'local', id: 'nodes' } }, via: { kind: 'builtin', name: 'DIRECT' } }], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
  groups: [], rules: [{ id: 'rule', matcher: id === 'unused' ? remoteRuleMatcher('https://rules.example.test/Apple.list') : { kind: 'ruleset', id: 'shared' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
} } }, admin.id);
const snapshots = new SnapshotService(store, async url => url.includes('nodes.example.test')
  ? { status: 200, body: 'proxies: [{ name: 流量测试节点, type: socks5, server: fixture.example.test, port: 1080 }]', userinfo: { upload: 0, download: 1073741824, total: 10737418240, expire: 2000000000 } }
  : { status: 200, body: 'DOMAIN,apple.example.test' });
const renderer = new RenderService(store, snapshots, { publicUrl: 'http://127.0.0.1:5196' });
for (const id of ['first', 'second', 'unused']) await renderer.render(id, { client: 'mihomo' });
store.delete('profile', 'unused');
const app = createApp({ store, snapshots, renderer, publicUrl: 'http://127.0.0.1:5196', webDir: resolve('../web/dist') });
let resetAttempts = 0;
const server = serve({ hostname: '127.0.0.1', port: 5196, fetch: async request => {
  if (request.method === 'POST' && new URL(request.url).pathname === '/api/me/token/reset') {
    if (++resetAttempts === 1) return Response.json({ error: '验收模拟失败：原令牌保持有效，请重试' }, { status: 503 });
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return app.fetch(request);
} });
console.log('隔离验收 http://127.0.0.1:5196；managed-admin / managed-reader；密码 managed-test-2026；第一次重置模拟失败');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; store.closeEvents();
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
