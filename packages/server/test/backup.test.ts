import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { csrfGuard, HttpError } from '../src/api/common.ts';
import { backupRoutes } from '../src/api/backup.ts';
import { decodeBackup, encodeBackup } from '../src/backup/archive.ts';
import { applyStagedRestore, restorePending } from '../src/backup/restore.ts';
import { BackupService } from '../src/backup/service.ts';
import { Cipher, loadMasterKey } from '../src/crypto.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';
import { Store } from '../src/store.ts';

const dirs: string[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => { for (const run of cleanups.splice(0)) run(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function instance(start = Date.UTC(2026, 10, 2, 1, 0, 0), keyFromEnv = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sub-forge-backup-'));
  dirs.push(dir);
  const dbPath = join(dir, 'sub-forge.db');
  const masterKey = loadMasterKey(dbPath, undefined);
  const store = new Store(dbPath, { cipher: new Cipher(masterKey), now: () => start });
  const onRestoreStaged = vi.fn();
  const service = new BackupService(store, { dbPath, masterKey, keyFromEnv, onRestoreStaged, now: () => start });
  let closed = false;
  const close = () => { if (!closed) { closed = true; store.close(); } };
  cleanups.push(close);
  return { dir, dbPath, masterKey, store, service, onRestoreStaged, close };
}

it('备份文件可还原数据库与主密钥，损坏和非备份文件被拒绝', async () => {
  const db = Buffer.from('SQLite format 3 rows'), masterKey = Buffer.alloc(32, 7);
  const file = await encodeBackup({ db, masterKey, createdAt: 1, schemaVersion: SCHEMA_VERSION });
  const decoded = await decodeBackup(file);
  expect(decoded.db.equals(db)).toBe(true);
  expect(decoded.masterKey.equals(masterKey)).toBe(true);
  expect(decoded).toMatchObject({ createdAt: 1, schemaVersion: SCHEMA_VERSION });
  const tampered = Buffer.from(file); tampered[tampered.length - 6]! ^= 1;
  await expect(decodeBackup(tampered)).rejects.toThrow('已损坏');
  await expect(decodeBackup(Buffer.from('not a backup'))).rejects.toThrow('不是有效');
  await expect(decodeBackup(Buffer.from('SFBAK2\n{"v":2}\n'))).rejects.toThrow('不是有效');
});

it('旧版加密备份给出明确提示', async () => {
  await expect(decodeBackup(Buffer.from('SFBAK1\n{"v":1}\ncipher'))).rejects.toThrow('旧版加密备份');
});

it('生成带时间戳的备份文件，服务端不留快照', async () => {
  const h = instance();
  const { name, body } = await h.service.create();
  expect(name).toBe('sub-forge-20261102-010000.sfbak');
  expect((await decodeBackup(body)).masterKey.equals(h.masterKey)).toBe(true);
  expect(h.store.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  expect(readdirSync(h.dir).filter(file => file.startsWith('.backup-'))).toEqual([]);
});

it('下载和恢复接口走通，上传不受 JSON 限制且仍拒绝其他类型', async () => {
  const h = instance();
  const app = new Hono();
  app.onError((error, c) => { if (error instanceof HttpError) return c.json({ error: error.message }, error.status); throw error; });
  app.use('*', csrfGuard());
  app.use('*', async (c, next) => { c.set('user' as never, { id: 'admin', role: 'admin' } as never); await next(); });
  app.route('/api', backupRoutes(h.service) as never);
  const download = await app.request('/api/system/backup/download');
  expect(download.status).toBe(200);
  expect(download.headers.get('content-disposition')).toContain('sub-forge-20261102-010000.sfbak');
  const body = await download.arrayBuffer();
  const post = (type: string, payload: ArrayBuffer | Uint8Array<ArrayBuffer>, origin?: string) => app.request('/api/system/backup/restore', { method: 'POST', body: payload, headers: { 'content-type': type, 'content-length': '1', ...(origin ? { origin } : {}) } });
  expect((await post('text/plain', body)).status).toBe(400);
  expect((await post('application/octet-stream', body, 'https://evil.test')).status).toBe(403);
  expect((await post('application/octet-stream', new Uint8Array())).status).toBe(400);
  expect(restorePending(h.dbPath)).toBe(false);
  expect((await post('application/octet-stream', body)).status).toBe(202);
  expect(restorePending(h.dbPath)).toBe(true);
  expect(h.onRestoreStaged).toHaveBeenCalledOnce();
});

it('换机恢复：替换数据库与主密钥，登录和令牌继续可用', async () => {
  const source = instance();
  const owner = source.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' });
  const token = source.store.userToken(owner.id)!.token;
  source.store.put('local', { id: 'l', name: '本地节点', proxies: [] } as never, owner.id);
  const { body } = await source.service.create();

  const target = instance();
  target.store.createUser({ username: 'temporary', passwordHash: 'fixture', role: 'admin' });
  expect(target.masterKey.equals(source.masterKey)).toBe(false);
  await target.service.restore(body);
  expect(target.onRestoreStaged).toHaveBeenCalledOnce();
  expect(restorePending(target.dbPath)).toBe(true);
  await expect(target.service.create()).rejects.toThrow('正在重启');
  // 暂存期间运行中的数据库不变
  expect(target.store.getUserAuth('temporary')).toBeTruthy();
  target.close();
  const oldKey = readFileSync(join(target.dir, 'secret.key'), 'utf8');

  expect(applyStagedRestore(target.dbPath)).toBe(true);
  expect(existsSync(`${target.dbPath}.restore`)).toBe(false);
  expect(readFileSync(join(target.dir, 'secret.key.before-restore'), 'utf8')).toBe(oldKey);
  expect(existsSync(`${target.dbPath}.before-restore`)).toBe(true);
  const reopenedKey = loadMasterKey(target.dbPath, undefined);
  expect(reopenedKey.equals(source.masterKey)).toBe(true);
  const reopened = new Store(target.dbPath, { cipher: new Cipher(reopenedKey) });
  cleanups.push(() => reopened.close());
  expect(reopened.getUserAuth('temporary')).toBeUndefined();
  expect(reopened.getUserAuth('owner')).toBeTruthy();
  expect(reopened.userToken(owner.id)!.token).toBe(token);
  expect(reopened.get('local', 'l')?.name).toBe('本地节点');
});

it('环境变量主密钥不一致或备份版本更新时拒绝恢复且不留暂存', async () => {
  const source = instance();
  const { body } = await source.service.create();
  const envBound = instance(undefined, true);
  await expect(envBound.service.restore(body)).rejects.toThrow('SUBFORGE_SECRET');
  expect(existsSync(`${envBound.dbPath}.restore`)).toBe(false);
  const contents = await decodeBackup(body);
  await expect(source.service.restore(await encodeBackup({ ...contents, schemaVersion: SCHEMA_VERSION + 1 }))).rejects.toThrow('更新的版本');
  expect(existsSync(`${source.dbPath}.restore`)).toBe(false);
});

it('损坏的数据库不能进入暂存；未就绪的暂存在启动时被丢弃', async () => {
  const h = instance();
  await expect(h.service.restore(await encodeBackup({ db: Buffer.from('garbage'.repeat(100)), masterKey: h.masterKey, createdAt: 1, schemaVersion: SCHEMA_VERSION }))).rejects.toThrow('无法打开');
  expect(existsSync(`${h.dbPath}.restore`)).toBe(false);
  const stage = `${h.dbPath}.restore`;
  mkdirSync(stage);
  writeFileSync(join(stage, 'db'), 'partial');
  expect(applyStagedRestore(h.dbPath)).toBe(false);
  expect(existsSync(stage)).toBe(false);
});
