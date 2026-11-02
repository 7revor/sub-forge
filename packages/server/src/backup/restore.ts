// 恢复分两阶段：运行中只写入并校验暂存目录，服务关闭数据库后再替换文件。
// 替换步骤可重入：进程在任一步崩溃，下次启动会从暂存目录继续完成。
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Cipher } from '../crypto.ts';
import { SCHEMA_VERSION } from '../schema.ts';
import { Store } from '../store.ts';
import type { BackupContents } from './archive.ts';
import { BackupError } from './errors.ts';

const stageDir = (dbPath: string) => `${dbPath}.restore`;

export function restorePending(dbPath: string): boolean {
  return existsSync(join(stageDir(dbPath), 'ready'));
}

/** 校验备份并写入暂存目录；此时不影响运行中的数据库。 */
export async function stageRestore(dbPath: string, backup: BackupContents, options: { currentKey: Buffer; keyFromEnv: boolean; prepare: (restored: Store) => void }): Promise<void> {
  if (backup.schemaVersion > SCHEMA_VERSION) throw new BackupError(400, `备份来自更新的版本（结构 v${backup.schemaVersion}），当前版本只支持到 v${SCHEMA_VERSION}，请先升级`);
  const sameKey = backup.masterKey.equals(options.currentKey);
  if (options.keyFromEnv && !sameKey) throw new BackupError(400, '备份使用的主密钥与 SUBFORGE_SECRET 不一致。请移除该环境变量改用 secret.key，或改为备份时的密钥后重试');
  const dir = stageDir(dbPath);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const file = join(dir, 'db');
    writeFileSync(file, backup.db, { mode: 0o600 });
    // 打开即执行迁移：旧结构的备份在此升级，失败时运行中的数据不受影响。
    let restored: Store;
    try { restored = new Store(file, { cipher: new Cipher(backup.masterKey) }); }
    catch (error) { throw new BackupError(400, `备份数据库无法打开：${error instanceof Error ? error.message : String(error)}`); }
    try {
      const integrity = restored.db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new BackupError(400, `备份数据库校验失败：${String(integrity)}`);
      options.prepare(restored);
    } finally { restored.close(); }
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    if (!options.keyFromEnv) writeFileSync(join(dir, 'key'), `${backup.masterKey.toString('base64')}\n`, { mode: 0o600 });
    writeFileSync(join(dir, 'ready'), '');
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** 必须在打开数据库之前调用。替换前保留一份 `.before-restore`，下次恢复时覆盖。 */
export function applyStagedRestore(dbPath: string): boolean {
  const dir = stageDir(dbPath);
  if (!existsSync(join(dir, 'ready'))) {
    rmSync(dir, { recursive: true, force: true }); // 暂存未完成，整包作废
    return false;
  }
  const stagedDb = join(dir, 'db'), stagedKey = join(dir, 'key'), keyFile = join(dirname(dbPath), 'secret.key');
  if (existsSync(stagedDb)) {
    if (existsSync(dbPath)) copyFileSync(dbPath, `${dbPath}.before-restore`);
    if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${dbPath}.before-restore-wal`);
    else rmSync(`${dbPath}.before-restore-wal`, { force: true });
    if (existsSync(keyFile)) copyFileSync(keyFile, `${keyFile}.before-restore`);
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    renameSync(stagedDb, dbPath);
  }
  if (existsSync(stagedKey)) renameSync(stagedKey, keyFile);
  rmSync(dir, { recursive: true, force: true });
  return true;
}
