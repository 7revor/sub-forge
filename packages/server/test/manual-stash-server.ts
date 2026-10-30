import { stringify as testYaml } from 'yaml';
// 内置浏览器隔离验收：虚构账号、内存数据库和固定上游，不读写用户数据。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
const store = new Store(':memory:');
const user = store.createUser({ username: 'stash-admin', passwordHash: await hashPassword('stash-demo-2026'), role: 'admin' });
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
store.importSeed({
  locals: [{ id: 'demo', name: '演示节点', proxies: [
    { name: '香港节点', type: 'trojan', server: 'hk.example.test', port: 443, password: 'example' },
    { name: '日本节点', type: 'hysteria2', server: 'jp.example.test', port: 443, password: 'hy2-example' },
  ] }],
  rulesets: [{ id: 'paypal', name: 'Stash 规则验收', sources: [{ id: 'main', kind: 'local', format: 'auto', content: 'DOMAIN,paypal.test\nUSER-AGENT,PayPal*\nPROCESS-NAME,Example\nDOMAIN-REGEX,^example\\.test$\nIP-CIDR,192.0.2.0/24,no-resolve' }] }],
  presets: [{ id: 'dual', name: '双客户端预设', version: 1, config: { kernels: {mihomo: testYaml({ mode: 'rule', 'mixed-port': 7890 }), stash: testYaml({ mode: 'rule', dns: { nameserver: ['https://doh.pub/dns-query'] } }) } } }],
  profiles: [{ id: 'stash-demo', name: 'Stash 订阅验收', base: { presetId: 'dual' }, nodeSets: [{ ref: { type: 'local', id: 'demo' }, output: 'provider' }], overlay: {}, refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'independent', config: {
    groups: [{ id: 'proxy', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'demo' } }] }],
    rules: [{ id: 'rules', matcher: { kind: 'ruleset', id: 'paypal' }, target: { kind: 'group', groupId: 'proxy' } }], final: direct,
  } } }],
  tokens: [{ token: 'stash-demo-token', userId: user.id }],
}, user.id);
const snapshots = new SnapshotService(store, async url => { throw new Error(`验收禁止访问上游：${url}`); });
const publicUrl = 'http://127.0.0.1:5198';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5198 });
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
