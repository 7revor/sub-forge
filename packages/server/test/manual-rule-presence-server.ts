// 规则无启用开关的隔离浏览器验收：内存数据库、虚构数据，不访问外部上游。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
const store = new Store(':memory:');
const user = store.createUser({ username: 'presence-admin', passwordHash: await hashPassword('presence-test-2026'), role: 'admin' });
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const rules = [
  { id: 'on', matcher: { kind: 'rule' as const, rule: { type: 'DOMAIN' as const, value: 'on.example.test' } }, target: direct, enabled: true },
  { id: 'off', matcher: { kind: 'rule' as const, rule: { type: 'DOMAIN' as const, value: 'off.example.test' } }, target: direct, enabled: false },
];
store.importSeed({ templates: [{ id: 'template', name: '存在即生效模板', version: 1, groups: [], rules, final: direct }],
  rulesets: [{ id: 'rules', name: '存在即生效规则集', sources: [
    { id: 'on', name: '本地规则', kind: 'local', format: 'auto', content: 'DOMAIN,local.example.test', enabled: true },
    { id: 'off', name: '旧停用来源', kind: 'remote', format: 'auto', url: 'https://unused.example.test/rules', enabled: false },
  ] }], profiles: [
    { id: 'bound', name: '绑定订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, revision: 1, templateVersion: 1,
      routing: { mode: 'bound', templateId: 'template', groupAdditions: {}, prependRules: rules.map(r => ({ ...r, id: `pre-${r.id}` })) } },
    { id: 'independent', name: '独立订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, revision: 1,
      routing: { mode: 'independent', config: { groups: [], rules, final: direct } } },
  ],
}, user.id);
const snapshots = new SnapshotService(store, async () => { throw new Error('验收不应访问上游'); });
const publicUrl = 'http://127.0.0.1:5197';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5197 });
console.log(`隔离验收：${publicUrl}；账号 presence-admin，密码 presence-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
