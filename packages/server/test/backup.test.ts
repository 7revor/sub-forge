import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { decodeBackup, encodeBackup } from '../src/backup/archive.ts';
import { applyStagedRestore, restorePending } from '../src/backup/restore.ts';
import { BackupService } from '../src/backup/service.ts';
import { parseMultistatus, type FetchLike } from '../src/backup/webdav.ts';
import { Cipher, loadMasterKey } from '../src/crypto.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';
import { Store } from '../src/store.ts';

const BASE = 'https://dav.test/backups/';
const dirs: string[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const run of cleanups.splice(0)) run(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** 内存 WebDAV：只实现客户端用到的方法，并校验 Basic 凭据。 */
function fakeDav(options: { user?: string; password?: string } = {}) {
  const files = new Map<string, Uint8Array>();
  const calls: { method: string; url: string; authorization?: string }[] = [];
  let directory = false;
  const failing = { put: false, remove: false };
  const handler: FetchLike = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET';
    const authorization = (init?.headers as Record<string, string>).authorization;
    calls.push({ method, url, ...(authorization ? { authorization } : {}) });
    if (options.user && authorization !== `Basic ${Buffer.from(`${options.user}:${options.password}`).toString('base64')}`) return new Response(null, { status: 401 });
    const name = decodeURIComponent(url.slice(BASE.length));
    if (method === 'PROPFIND') {
      if (!directory) return new Response(null, { status: 404 });
      const rows = [...files].map(([file, body]) => `<d:response><d:href>/backups/${encodeURIComponent(file)}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${body.length}</d:getcontentlength><d:getlastmodified>Mon, 02 Nov 2026 01:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>`);
      return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/backups/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>${rows.join('')}</d:multistatus>`, { status: 207 });
    }
    if (method === 'MKCOL') { directory = true; return new Response(null, { status: 201 }); }
    if (method === 'PUT') {
      if (failing.put) return new Response(null, { status: 507 });
      files.set(name, init!.body as Uint8Array);
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') return files.has(name) ? new Response(files.get(name)) : new Response(null, { status: 404 });
    if (method === 'DELETE') {
      if (failing.remove) return new Response(null, { status: 500 });
      files.delete(name);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { files, calls, failing, fetch: vi.fn(handler) };
}

function instance(dav: ReturnType<typeof fakeDav>, start = Date.UTC(2026, 10, 2, 1, 0, 0), keyFromEnv = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sub-forge-backup-'));
  dirs.push(dir);
  const dbPath = join(dir, 'sub-forge.db');
  const masterKey = loadMasterKey(dbPath, undefined);
  let t = start;
  const store = new Store(dbPath, { cipher: new Cipher(masterKey), now: () => t });
  const onRestoreStaged = vi.fn();
  const service = new BackupService(store, { dbPath, masterKey, keyFromEnv, onRestoreStaged, now: () => t, fetch: dav.fetch as FetchLike });
  let closed = false;
  const close = () => { if (!closed) { closed = true; store.close(); } };
  cleanups.push(close);
  return { dir, dbPath, masterKey, store, service, onRestoreStaged, close, advance: (ms: number) => { t += ms; } };
}

const configure = (h: ReturnType<typeof instance>) => h.service.save({ url: 'https://dav.test/backups', username: 'alice', password: 'dav-secret', passphrase: 'correct horse', intervalHours: 24, retain: 2 });

it('备份文件不含明文，错误口令无法解密，正确口令还原数据库与主密钥', async () => {
  const db = Buffer.from('SQLite format 3 secret-rows'), masterKey = Buffer.alloc(32, 7);
  const file = await encodeBackup({ db, masterKey, createdAt: 1, schemaVersion: SCHEMA_VERSION }, 'correct horse');
  expect(file.includes('secret-rows')).toBe(false);
  expect(file.includes(masterKey)).toBe(false);
  await expect(decodeBackup(file, 'wrong passphrase')).rejects.toThrow('备份口令不正确');
  const decoded = await decodeBackup(file, 'correct horse');
  expect(decoded.db.equals(db)).toBe(true);
  expect(decoded.masterKey.equals(masterKey)).toBe(true);
  const tampered = Buffer.from(file); tampered[tampered.length - 20]! ^= 1;
  await expect(decodeBackup(tampered, 'correct horse')).rejects.toThrow('备份口令不正确');
  await expect(decodeBackup(Buffer.from('not a backup'), 'correct horse')).rejects.toThrow('不是有效');
});

it('解析不同命名空间前缀的 PROPFIND 响应并跳过目录', () => {
  expect(parseMultistatus(`<multistatus xmlns="DAV:"><response><href>/a/</href><propstat><prop><resourcetype><collection /></resourcetype></prop></propstat></response>
    <response><href>/a/x%20y.sfbak</href><propstat><prop><getcontentlength>12</getcontentlength></prop></propstat></response></multistatus>`)).toEqual([{ name: 'x y.sfbak', size: 12 }]);
});

it('配置不返回凭据且落库加密；换站点不沿用旧密码', () => {
  const h = instance(fakeDav());
  const view = configure(h);
  expect(view).toMatchObject({ url: BASE, username: 'alice', hasPassword: true, hasPassphrase: true });
  expect(JSON.stringify(view)).not.toContain('dav-secret');
  expect(JSON.stringify(view)).not.toContain('correct horse');
  const raw = h.store.db.prepare("SELECT value FROM system_settings WHERE name = 'backup'").get() as { value: string };
  expect(raw.value).not.toContain('dav-secret');
  expect(h.service.save({ url: 'https://dav.test/other/' }).hasPassword).toBe(true);
  expect(h.service.save({ url: 'https://evil.test/' }).hasPassword).toBe(false);
  expect(() => h.service.save({ url: 'ftp://dav.test/' })).toThrow('http 或 https');
  expect(() => h.service.save({ url: 'https://u:p@dav.test/' })).toThrow('不要写进地址');
  expect(() => h.service.save({ passphrase: 'short' })).toThrow('至少 8 位');
  const fresh = instance(fakeDav());
  expect(() => fresh.service.save({ enabled: true, url: BASE })).toThrow('备份口令');
});

it('自动建目录、上传加密文件并只清理超出份数的备份文件', async () => {
  const dav = fakeDav({ user: 'alice', password: 'dav-secret' });
  const h = instance(dav);
  configure(h);
  dav.files.set('notes.txt', new Uint8Array([1]));
  const first = await h.service.run();
  expect(first.file).toBe('sub-forge-20261102-010000.sfbak');
  expect(dav.calls.some(call => call.method === 'MKCOL')).toBe(true);
  h.advance(3600_000); await h.service.run();
  h.advance(3600_000); await h.service.run();
  expect([...dav.files.keys()].sort()).toEqual(['notes.txt', 'sub-forge-20261102-020000.sfbak', 'sub-forge-20261102-030000.sfbak']);
  expect((await h.service.files()).map(file => file.name)).toEqual(['sub-forge-20261102-030000.sfbak', 'sub-forge-20261102-020000.sfbak']);
  expect(h.service.view().state).toMatchObject({ lastFile: 'sub-forge-20261102-030000.sfbak' });
});

it('失败写入状态且不清理旧文件；认证错误有明确提示', async () => {
  const dav = fakeDav();
  const h = instance(dav);
  configure(h);
  await h.service.run();
  dav.failing.put = true;
  h.advance(3600_000);
  await expect(h.service.run()).rejects.toThrow('存储空间不足');
  expect(h.service.view().state.lastError).toContain('存储空间不足');
  expect(dav.files.size).toBe(1);
  dav.failing.put = false;
  h.advance(3600_000);
  await h.service.run();
  expect(h.service.view().state.lastError).toBeUndefined();
  const denied = instance(fakeDav({ user: 'alice', password: 'other' }));
  configure(denied);
  await expect(denied.service.test({})).rejects.toThrow('账号或密码不正确');
});

it('定时任务按间隔运行，关闭后不再运行', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const dav = fakeDav();
  const h = instance(dav);
  configure(h);
  h.service.save({ enabled: true, intervalHours: 1 });
  h.service.start();
  await vi.waitFor(() => expect(dav.files.size).toBe(1));
  await vi.waitFor(() => expect(h.service.view().running).toBe(false));
  vi.advanceTimersByTime(60_000);
  expect(dav.files.size).toBe(1);
  h.advance(3600_000);
  vi.advanceTimersByTime(60_000);
  await vi.waitFor(() => expect(dav.files.size).toBe(2));
  await vi.waitFor(() => expect(h.service.view().running).toBe(false));
  await h.service.stop();
  h.advance(3600_000);
  vi.advanceTimersByTime(60_000);
  expect(dav.files.size).toBe(2);
});

it('换机恢复：替换数据库与主密钥，保留当前 WebDAV 配置，可继续解密', async () => {
  const dav = fakeDav();
  const source = instance(dav);
  configure(source);
  const owner = source.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' });
  const token = source.store.userToken(owner.id)!.token;
  source.store.put('local', { id: 'l', name: '本地节点', proxies: [] } as never, owner.id);
  const { file } = await source.service.run();

  const target = instance(dav);
  target.service.save({ url: BASE });
  target.store.createUser({ username: 'temporary', passwordHash: 'fixture', role: 'admin' });
  expect(target.masterKey.equals(source.masterKey)).toBe(false);
  await expect(target.service.restore(file)).rejects.toThrow('请填写备份口令');
  await expect(target.service.restore(file, 'wrong passphrase')).rejects.toThrow('备份口令不正确');
  await expect(target.service.restore('../secret.key', 'correct horse')).rejects.toThrow('文件名不合法');
  expect(restorePending(target.dbPath)).toBe(false);
  await target.service.restore(file, 'correct horse');
  expect(target.onRestoreStaged).toHaveBeenCalledOnce();
  expect(restorePending(target.dbPath)).toBe(true);
  await expect(target.service.run()).rejects.toThrow('正在重启');
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
  // 保留恢复前这台实例的配置（没有账号、口令），并记录恢复
  expect(reopened.getSecureSetting<{ url: string; username: string }>('backup')).toMatchObject({ url: BASE, username: '' });
  expect(reopened.getSecureSetting<{ lastRestoreFile: string }>('backupState')?.lastRestoreFile).toBe(file);
});

it('环境变量主密钥不一致或备份版本更新时拒绝恢复且不留暂存', async () => {
  const dav = fakeDav();
  const source = instance(dav);
  configure(source);
  const { file } = await source.service.run();
  const envBound = instance(dav, undefined, true);
  envBound.service.save({ url: BASE, passphrase: 'correct horse' });
  await expect(envBound.service.restore(file)).rejects.toThrow('SUBFORGE_SECRET');
  expect(existsSync(`${envBound.dbPath}.restore`)).toBe(false);
  const contents = await decodeBackup(Buffer.from(dav.files.get(file)!), 'correct horse');
  dav.files.set('sub-forge-20991231-000000.sfbak', await encodeBackup({ ...contents, schemaVersion: SCHEMA_VERSION + 1 }, 'correct horse'));
  source.service.save({ url: BASE });
  await expect(source.service.restore('sub-forge-20991231-000000.sfbak')).rejects.toThrow('更新的版本');
});

it('损坏的数据库不能进入暂存；未就绪的暂存在启动时被丢弃', async () => {
  const dav = fakeDav();
  const h = instance(dav);
  configure(h);
  dav.files.set('sub-forge-20260101-000000.sfbak', await encodeBackup({ db: Buffer.from('garbage'.repeat(100)), masterKey: h.masterKey, createdAt: 1, schemaVersion: SCHEMA_VERSION }, 'correct horse'));
  await expect(h.service.restore('sub-forge-20260101-000000.sfbak')).rejects.toThrow('无法打开');
  expect(existsSync(`${h.dbPath}.restore`)).toBe(false);
  rmSync(`${h.dbPath}.restore`, { recursive: true, force: true });
  const stage = `${h.dbPath}.restore`;
  mkdirSync(stage);
  writeFileSync(join(stage, 'db'), 'partial');
  expect(applyStagedRestore(h.dbPath)).toBe(false);
  expect(existsSync(stage)).toBe(false);
});
