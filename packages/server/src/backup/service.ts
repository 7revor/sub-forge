// 数据库定时备份：一致性快照 → 口令加密 → 上传 WebDAV → 按份数清理。
// 配置（含 WebDAV 密码与备份口令）用主密钥加密后存 system_settings，接口只返回是否已设置。
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION } from '../schema.ts';
import type { Store } from '../store.ts';
import { decodeBackup, encodeBackup } from './archive.ts';
import { BackupError } from './errors.ts';
import { stageRestore } from './restore.ts';
import { normalizeWebDavUrl, WebDavClient, type FetchLike, type WebDavFile } from './webdav.ts';

const SETTINGS = 'backup';
const STATE = 'backupState';
const FILE_NAME = /^sub-forge-\d{8}-\d{6}\.sfbak$/;
const HOUR_MS = 3600_000;
const MIN_PASSPHRASE = 8;

export type BackupSettings = { enabled: boolean; url: string; username: string; password: string; passphrase: string; intervalHours: number; retain: number };
export type BackupState = { lastAttemptAt?: number; lastSuccessAt?: number; lastFile?: string; lastSize?: number; lastError?: string; lastWarning?: string; lastRestoreAt?: number; lastRestoreFile?: string };
export type BackupSettingsInput = { enabled?: unknown; url?: unknown; username?: unknown; password?: unknown; passphrase?: unknown; intervalHours?: unknown; retain?: unknown };
export type BackupOptions = { dbPath: string; masterKey: Buffer; keyFromEnv: boolean; onRestoreStaged: () => void; now?: () => number; fetch?: FetchLike };

const DEFAULTS: BackupSettings = { enabled: false, url: '', username: '', password: '', passphrase: '', intervalHours: 24, retain: 7 };
const sameOrigin = (a: string, b: string) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };
const text = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BackupError(400, `${name}必须是字符串`);
  return value;
};
const integer = (value: unknown, name: string, min: number, max: number): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BackupError(400, `${name}必须是 ${min} 至 ${max} 的整数`);
  return value;
};

export class BackupService {
  private readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<unknown>;
  private restarting = false;
  private stopped = false;

  constructor(private store: Store, private options: BackupOptions) {
    this.now = options.now ?? Date.now;
  }

  private settings(): BackupSettings { return { ...DEFAULTS, ...this.store.getSecureSetting<Partial<BackupSettings>>(SETTINGS) }; }
  private state(): BackupState { return this.store.getSecureSetting<BackupState>(STATE) ?? {}; }
  private patchState(patch: BackupState): void {
    const next = { ...this.state(), ...patch };
    for (const key of Object.keys(patch) as (keyof BackupState)[]) if (patch[key] === undefined) delete next[key];
    this.store.setSecureSetting(STATE, next);
    this.store.changed();
  }
  private client(settings: Pick<BackupSettings, 'url' | 'username' | 'password'>): WebDavClient {
    if (!settings.url) throw new BackupError(400, '请先配置 WebDAV 地址');
    return new WebDavClient(settings, this.options.fetch);
  }

  view() {
    const { password, passphrase, ...settings } = this.settings();
    const state = this.state();
    return {
      ...settings, hasPassword: !!password, hasPassphrase: !!passphrase, running: !!this.work, state,
      // 从未备份时下一轮调度（一分钟内）就会执行。
      ...(settings.enabled ? { nextRunAt: state.lastAttemptAt === undefined ? this.now() : state.lastAttemptAt + settings.intervalHours * HOUR_MS } : {}),
    };
  }

  save(input: BackupSettingsInput) {
    const current = this.settings();
    const urlInput = text(input.url, 'WebDAV 地址');
    const url = urlInput === undefined ? current.url : urlInput.trim() ? normalizeWebDavUrl(urlInput) : '';
    const username = text(input.username, 'WebDAV 账号')?.trim() ?? current.username;
    const passwordInput = text(input.password, 'WebDAV 密码');
    // 留空沿用已保存的密码；换站点时不把旧凭据带给新地址。
    const password = passwordInput || (username && sameOrigin(url, current.url) ? current.password : '');
    const passphrase = text(input.passphrase, '备份口令') || current.passphrase;
    if (passphrase && passphrase.length < MIN_PASSPHRASE) throw new BackupError(400, `备份口令至少 ${MIN_PASSPHRASE} 位`);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new BackupError(400, '定时备份开关必须是布尔值');
    const next: BackupSettings = {
      enabled: (input.enabled as boolean | undefined) ?? current.enabled, url, username, password, passphrase,
      intervalHours: integer(input.intervalHours, '备份间隔', 1, 8760) ?? current.intervalHours,
      retain: integer(input.retain, '保留份数', 1, 365) ?? current.retain,
    };
    if (next.enabled && !next.url) throw new BackupError(400, '启用定时备份前请填写 WebDAV 地址');
    if (next.enabled && !next.passphrase) throw new BackupError(400, '启用定时备份前请设置备份口令');
    this.store.setSecureSetting(SETTINGS, next);
    this.store.changed();
    return this.view();
  }

  /** 测试草稿；密码留空时只在站点未变时沿用已保存的密码。 */
  async test(input: BackupSettingsInput): Promise<{ count: number }> {
    const current = this.settings();
    const url = normalizeWebDavUrl(text(input.url, 'WebDAV 地址') ?? current.url);
    const username = text(input.username, 'WebDAV 账号')?.trim() ?? current.username;
    const password = text(input.password, 'WebDAV 密码') || (sameOrigin(url, current.url) ? current.password : '');
    const client = this.client({ url, username, password });
    await client.ensureDirectory();
    return { count: (await client.list()).filter(file => FILE_NAME.test(file.name)).length };
  }

  async files(): Promise<WebDavFile[]> {
    const settings = this.settings();
    if (!settings.url) return [];
    return (await this.client(settings).list()).filter(file => FILE_NAME.test(file.name)).sort((a, b) => b.name.localeCompare(a.name));
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.restarting) return Promise.reject(new BackupError(409, '服务正在重启以完成恢复'));
    if (this.work) return Promise.reject(new BackupError(409, '已有备份或恢复任务在运行'));
    const work = run().finally(() => { this.work = undefined; this.store.changed(); });
    this.work = work;
    this.store.changed();
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

  /** 上传成功才清理旧文件；只清理本服务命名格式的文件，不碰目录里的其他内容。 */
  private async execute(settings: BackupSettings): Promise<{ file: string; size: number }> {
    if (!settings.passphrase) throw new BackupError(400, '请先设置备份口令');
    const at = this.now();
    this.patchState({ lastAttemptAt: at });
    try {
      const client = this.client(settings);
      await client.ensureDirectory();
      const body = await encodeBackup({ db: await this.snapshot(), masterKey: this.options.masterKey, createdAt: at, schemaVersion: SCHEMA_VERSION }, settings.passphrase);
      const name = this.fileName(at);
      await client.put(name, body);
      const listed = (await client.list()).filter(file => FILE_NAME.test(file.name));
      const uploaded = listed.find(file => file.name === name);
      if (!uploaded) throw new BackupError(502, '上传备份失败：WebDAV 列表中找不到刚上传的文件');
      if (uploaded.size !== undefined && uploaded.size !== body.length) throw new BackupError(502, `上传备份失败：文件大小不一致（${uploaded.size} / ${body.length}）`);
      let warning: string | undefined;
      const stale = listed.map(file => file.name).sort().reverse().slice(settings.retain);
      for (const old of stale) {
        try { await client.remove(old); }
        catch (error) {
          warning = error instanceof Error ? error.message : String(error);
          console.warn(`清理旧备份 ${old} 失败：${warning}`);
        }
      }
      this.patchState({ lastSuccessAt: at, lastFile: name, lastSize: body.length, lastError: undefined, lastWarning: warning });
      return { file: name, size: body.length };
    } catch (error) {
      this.patchState({ lastError: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  run(): Promise<{ file: string; size: number }> {
    return this.exclusive(() => this.execute(this.settings()));
  }

  /** 校验通过后才暂存，并通知入口关闭服务、替换文件、重新启动。 */
  restore(name: string, passphraseInput?: string): Promise<void> {
    if (!FILE_NAME.test(name)) return Promise.reject(new BackupError(400, '备份文件名不合法'));
    return this.exclusive(async () => {
      const settings = this.settings();
      const passphrase = passphraseInput || settings.passphrase;
      if (!passphrase) throw new BackupError(400, '请填写备份口令');
      const backup = await decodeBackup(await this.client(settings).get(name), passphrase);
      const state = this.state();
      await stageRestore(this.options.dbPath, backup, {
        currentKey: this.options.masterKey, keyFromEnv: this.options.keyFromEnv,
        // 恢复目标是业务数据：当前这份 WebDAV 配置刚验证可用，保留它才能继续备份和再次恢复。
        prepare: restored => {
          restored.setSecureSetting(SETTINGS, settings);
          restored.setSecureSetting(STATE, { ...state, lastRestoreAt: this.now(), lastRestoreFile: name } satisfies BackupState);
        },
      });
      this.restarting = true;
      this.options.onRestoreStaged();
    });
  }

  private tick(): void {
    const settings = this.settings();
    if (this.stopped || this.work || this.restarting || !settings.enabled) return;
    const last = this.state().lastAttemptAt;
    if (last !== undefined && this.now() < last + settings.intervalHours * HOUR_MS) return;
    this.run().catch(error => console.error('定时备份失败', error instanceof Error ? error.message : error));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.work?.catch(() => undefined); // 任务错误已写入状态，这里只等待结束
  }
}
