// 数据库手动备份：下载时生成一致性快照，上传备份文件后校验并恢复。
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION } from '../schema.ts';
import type { Store } from '../store.ts';
import { decodeBackup, encodeBackup } from './archive.ts';
import { BackupError } from './errors.ts';
import { stageRestore } from './restore.ts';

export type BackupOptions = { dbPath: string; masterKey: Buffer; keyFromEnv: boolean; onRestoreStaged: () => void; now?: () => number };

export class BackupService {
  private readonly now: () => number;
  private work?: Promise<unknown>;
  private restarting = false;

  constructor(private store: Store, private options: BackupOptions) {
    this.now = options.now ?? Date.now;
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.restarting) return Promise.reject(new BackupError(409, '服务正在重启以完成恢复'));
    if (this.work) return Promise.reject(new BackupError(409, '已有备份或恢复任务在运行'));
    const work = run().finally(() => { this.work = undefined; });
    this.work = work;
    return work;
  }

  private async snapshot(): Promise<Buffer> {
    const dbPath = this.options.dbPath;
    const file = join(dbPath === ':memory:' ? tmpdir() : dirname(dbPath), `.backup-${randomBytes(6).toString('hex')}.db`);
    try {
      await this.store.db.backup(file);
      return await readFile(file);
    } finally {
      await rm(file, { force: true });
    }
  }

  private fileName(at: number): string {
    return `sub-forge-${new Date(at).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.sfbak`;
  }

  /** 生成一份备份文件交给调用方下载，服务端不留副本。 */
  create(): Promise<{ name: string; body: Buffer }> {
    return this.exclusive(async () => {
      const at = this.now();
      const body = await encodeBackup({ db: await this.snapshot(), masterKey: this.options.masterKey, createdAt: at, schemaVersion: SCHEMA_VERSION });
      return { name: this.fileName(at), body };
    });
  }

  /** 校验通过后才暂存，并通知入口关闭服务、替换文件、重新启动。 */
  restore(file: Buffer): Promise<void> {
    return this.exclusive(async () => {
      await stageRestore(this.options.dbPath, await decodeBackup(file), { currentKey: this.options.masterKey, keyFromEnv: this.options.keyFromEnv });
      this.restarting = true;
      this.options.onRestoreStaged();
    });
  }

  /** 关闭数据库前等待进行中的任务；任务错误已由发起请求处理。 */
  async stop(): Promise<void> {
    await this.work?.catch(() => undefined);
  }
}
