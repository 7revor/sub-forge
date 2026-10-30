// 订阅标签页与首页访问日志验收：仅虚构数据和内存数据库，退出即丢弃。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
import { remoteRuleMatcher, type GroupSpec } from '@sub-forge/core';
import { parse } from 'yaml';

const store = new Store(':memory:');
const user = store.createUser({ username: 'dialog-admin', passwordHash: await hashPassword('dialog-test-2026'), role: 'admin' });
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const groups: GroupSpec[] = [
  { id: 'select', name: '节点选择', type: 'select', members: [direct] },
  { id: 'fallback', name: '故障转移', type: 'fallback', test: { interval: 300, timeout: 5000, lazy: true }, members: [direct] },
  { id: 'balance', name: '负载均衡', type: 'load-balance', strategy: 'round-robin', members: [direct] },
];
const rules = [{ id: 'rule', matcher: { kind: 'rule' as const, rule: { type: 'DOMAIN' as const, value: 'dialog.example.test' } }, target: direct }];
store.importSeed({ templates: [{ id: 'dialog-template', name: '日常分流模板', version: 1, groups, rules, final: direct }],
  locals: [{ id: 'dialog-nodes', name: '虚构节点', proxies: [{ name: '虚构节点一', type: 'ss', server: 'node.example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture-only' }] }],
  rulesets: [{ id: 'dialog-rules', name: '自定义增强集合', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,fixture.example.test' }] }],
  profiles: [
    { id: 'bound', name: '日常订阅', nodeSets: [{ ref: { type: 'local', id: 'dialog-nodes' }, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: 'dialog-template', groupAdditions: {}, prependRules: [] } },
    { id: 'independent', name: '独立订阅', nodeSets: [{ ref: { type: 'local', id: 'dialog-nodes' }, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups, rules, final: direct } } },
  ],
}, user.id);
const snapshots = new SnapshotService(store, async () => ({ status: 200, body: 'DOMAIN,fixture.example.test' }));
store.putTemplateVersion({ id: 'alternate', name: '备用模板', groups: [{ id: 'new-select', name: '节点选择', type: 'select', members: [direct] }], rules: [], final: { kind: 'group', groupId: 'new-select' } });
const bound = store.get('profile', 'bound')!;
store.put('profile', { ...bound, routing: { mode: 'bound', templateId: 'dialog-template', groupAdditions: { select: [{ kind: 'nodeset', ref: { type: 'local', id: 'dialog-nodes' } }] } } }, user.id);
store.put('profile', { ...store.get('profile', 'independent')!, routing: { mode: 'independent', config: { groups: [], rules: [{ id: 'public', matcher: remoteRuleMatcher('https://fixture.test/Apple.list'), target: direct }], final: direct } } }, user.id);
const publicUrl = 'http://127.0.0.1:18719';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const token = store.userToken(user.id)!.token;
const ruleConfig = parse(await (await app.request(`/subs/profile?token=${token}&id=independent`)).text());
const ruleUrl = Object.values<{ url: string }>(ruleConfig['rule-providers'])[0]!.url;
for (let i = 0; i < 6; i++) {
  await app.request(`/subs/profile?token=${token}&id=bound`, { headers: { 'user-agent': 'ClashMetaForAndroid' } });
  await app.request(`/subs/nodes?token=${token}&kind=local&id=dialog-nodes`, { headers: { 'user-agent': 'Stash/3.1 iOS' } });
  await app.request(`/resources/ruleset?token=${token}&id=dialog-rules`);
  await app.request(ruleUrl);
}
await app.request(`/subs/profile?token=${token}&id=bound&target=unknown`);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18719 });
console.log(`隔离验收：${publicUrl}；账号 dialog-admin，密码 dialog-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled();
  store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
