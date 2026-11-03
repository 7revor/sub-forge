// 内置浏览器验收：临时 SQLite v33 真实升级，使用虚构文档，无拦截响应；退出时清理服务和数据库。
// 先构建前端，再从 packages/server 运行：pnpm exec tsx test/manual-stash-common-migration-server.ts
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { Cipher } from '../src/crypto.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';
import { addUser, independentRouting } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-stash-browser-')), file = join(dir, 'test.db');
const cipher = new Cipher(randomBytes(32));
let store = new Store(file, { cipher });
try {
  const user = await addUser(store, 'migration-admin', 'admin');
  const common = 'dns:\n  enable: true\n  use-hosts: true\n  ipv6: false\n  nameserver:\n    - 223.5.5.5\n';
  const legacy = [
    { id: 'duplicate', name: '重复公共配置迁移', base: { kernels: { mihomo: common, stash: common } } },
    { id: 'difference', name: 'Stash 专有差异迁移', base: { kernels: { mihomo: common, stash: common + 'log-level: warning\nmixed-port: 0\n' }, clients: { 'stash-ios': 'log-level: debug\n' } } },
  ];
  for (const item of legacy) store.db.prepare('INSERT INTO docs VALUES (?,?,?,?,?)').run('profile', item.id, user.id, cipher.encrypt(JSON.stringify({ ...item, chains: [], nodeSets: [], routing: independentRouting() })), 123);
  store.db.pragma('user_version = 33');
} finally { store.close(); }
store = new Store(file, { cipher });
const publicUrl = 'http://127.0.0.1:5267';
const snapshots = new SnapshotService(store, async () => { throw new Error('验收不使用远程上游'); });
const renderer = new RenderService(store, snapshots);
const app = createApp({ store, snapshots, renderer, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5267 });
console.log(`隔离迁移验收：${publicUrl}；账号 migration-admin，密码 password-123`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  store.closeEvents();
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
