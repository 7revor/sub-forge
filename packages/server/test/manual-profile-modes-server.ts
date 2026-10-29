// 内置浏览器验收：临时数据库从 v15 真实迁移；不读取生产库，不访问外部上游。
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { Cipher, hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
import type { ProfileDoc } from '../src/docs.ts';
const folder = mkdtempSync(join(tmpdir(), 'sub-forge-mode-acceptance-'));
const cipher = new Cipher(randomBytes(32));
const database = join(folder, 'acceptance.sqlite');
let store = new Store(database, { cipher });
const user = store.createUser({ username: 'mode-admin', passwordHash: await hashPassword('mode-test-2026'), role: 'admin' });
store.put('local', { id: 'nodes', name: '验收节点', proxies: [{ name: '香港节点 A', type: 'socks5', server: 'node-a.example.test', port: 1080 }, { name: '香港节点 B', type: 'socks5', server: 'node-b.example.test', port: 1080 }] }, user.id);
store.put('ruleset', { id: 'rules', name: '验收规则集', sources: [{ id: 'rules-src', kind: 'local', format: 'auto', content: 'DOMAIN,example.test' }] }, user.id);
store.putTemplateVersion({ id: 'mode-template', name: '模式验收模板', version: 1, groups: [
  { id: 'hk', name: '香港', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] },
  { id: 'auto', name: '自动', type: 'url-test', members: [{ kind: 'group', groupId: 'hk' }], test: { url: 'https://www.gstatic.com/generate_204', interval: 300 } },
], rules: [{ id: 'rule', matcher: { kind: 'ruleset', id: 'rules' }, target: { kind: 'group', groupId: 'hk' } }], final: { kind: 'group', groupId: 'auto' } });
const member = { kind: 'nodeset' as const, ref: { type: 'local' as const, id: 'nodes' } };
const profile: ProfileDoc = { id: 'bound', name: '旧数据·绑定', template: { id: 'mode-template', follow: 'latest' }, nodeSets: [{ ref: member.ref, output: 'provider' }], overlay: { groupPatches: { hk: { addMembers: [member] } } }, chains: [], refPolicy: { default: 'wrap' } };
store.put('profile', profile, user.id);
store.put('profile', { ...profile, id: 'custom', name: '旧数据·独立（私有配置）', overlay: { ...profile.overlay, extraGroups: [{ after: 'hk', group: { id: 'private', name: '私有测速组', type: 'url-test', test: { interval: 600 }, members: [member] } }], rulePatches: { rule: { target: { kind: 'group', groupId: 'private' } } }, final: { kind: 'group', groupId: 'private' } } }, user.id);
store.put('profile', { ...profile, id: 'pinned', name: '旧数据·锁定版本', template: { id: 'mode-template', follow: { pinned: 1 } } }, user.id);
store.putToken({ token: 'mode-acceptance-token', profileId: 'bound', label: '迁移前链接' });
store.db.pragma('user_version = 15'); store.close(); store = new Store(database, { cipher });
const snapshots = new SnapshotService(store, async () => { throw new Error('验收场景不使用外部上游'); });
const renderer = new RenderService(store, snapshots, { publicUrl: 'http://127.0.0.1:5194' });
const app = createApp({ store, snapshots, renderer, publicUrl: 'http://127.0.0.1:5194', webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5194 });
console.log('隔离验收：http://127.0.0.1:5194；账号 mode-admin，密码 mode-test-2026');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close(); rmSync(folder, { recursive: true });
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
