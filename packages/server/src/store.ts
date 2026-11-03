import { importSeedDocuments, migrateDatabase } from './store-migrations.ts';
import { migrateProfile, profileTemplate } from './profile-routing.ts';
// SQLite 存储。保存文档和上游快照；渲染结果不落库。
// 文档、快照和令牌原文明文存储（2026-11-02 修订 SYS-04）；数据库文件权限为 0600，备份凭据和备份文件仍加密。

import Database from 'better-sqlite3';
import { pageMeta, type PageOptions, type PageResult } from './pagination.ts';
import { matchesNameSearch, normalizeNameSearch } from '@sub-forge/core';
import { randomBytes } from 'node:crypto';
import { Cipher, randomId } from './crypto.ts';
import type { RuleSetFormat } from '@sub-forge/core';
import type { DocKind, DocTypes, DocInputTypes, FetchOptions, ProfileDoc, Seed, SourceDoc, TemplateVersionDoc, TokenDoc } from './docs.ts';
import { DEFAULT_TIMEOUT_MS, DEFAULT_UA } from './net/upstream.ts';
import { normalizeSourceFetch, stripResourceTiming } from './source-url.ts';

export type SnapshotOwner = 'source' | 'ruleset';
/** 规则读取参数；与 URL 一起构成规则快照身份，不含任何用户、配置或模板。 */
export type RuleFetchParams = FetchOptions & { format?: RuleSetFormat; behavior?: 'domain' | 'ipcidr' | 'classical' };

export type TrafficInfo = { upload?: number; download?: number; total?: number; expire?: number };

export type SnapshotRow = {
  id: number;
  ownerKind: SnapshotOwner;
  ownerId: string;
  url: string;
  fetchedAt: number;
  ok: boolean;
  status?: number;
  body?: string;
  hash?: string;
  userinfo?: TrafficInfo;
  error?: string;
};

export const ACCESS_KINDS = ['subscription', 'nodes', 'rule-collection', 'enhancement'] as const;
export type AccessKind = typeof ACCESS_KINDS[number];
export type UserAccessLogRow = Omit<AccessLogRow, 'token'> & { id: number; kind: AccessKind; resourceId: string; resourceName: string; method: string };

export type AccessLogRow = {
  clientIp?: string | null;
  token: string;
  profileId: string;
  at: number;
  ua: string;
  client: string;
  platform?: string;
  status: number;
  ms: number;
  warnings: number;
  source: string;
};

export type Role = 'admin' | 'user';
export type User = { id: string; username: string; role: Role; disabled: boolean; scriptAllowed: boolean; createdAt: number };

type RawSnapshot = {
  id: number; owner_kind: SnapshotOwner; owner_id: string; url: string; fetched_at: number;
  ok: number; status: number | null; body: string | null; hash: string | null; userinfo: string | null; error: string | null;
};

type RawUser = { id: string; username: string; password_hash: string; role: Role; disabled: number; script_allowed: number; created_at: number };

const toUser = (r: RawUser): User => ({ id: r.id, username: r.username, role: r.role, disabled: r.disabled === 1, scriptAllowed: r.script_allowed === 1, createdAt: r.created_at });

/** 有归属的文档种类；模板由管理员维护，所有人可引用 */
export const OWNED_KINDS = ['source', 'collection', 'local', 'ruleset', 'profile'] as const;

export type TemplateReader = { get(id: string, version?: number): TemplateVersionDoc | undefined; list(): TemplateVersionDoc[] };

export type StoreOptions = { now?: () => number; cipher?: Cipher };

export class Store {
  readonly db: Database.Database;
  readonly cipher: Cipher;
  private readonly now: () => number;

  /** 只在数据库升级期间为 true：此时旧数据可能仍是密文，升级结束后全部是明文。 */
  legacyEncoded = false;
  private readText(value: string): string { return this.legacyEncoded ? this.cipher.decrypt(value) : value; }

  constructor(path: string, opts: StoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    if (!opts.cipher && path !== ':memory:') throw new Error('持久化数据库必须提供主密钥');
    this.cipher = opts.cipher ?? new Cipher(randomBytes(32));
    this.db = new Database(path);
    this.db.function('search_fold', { deterministic: true }, (value: unknown) => normalizeNameSearch(typeof value === 'string' ? value : ''));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('secure_delete = ON');
    try { migrateDatabase(this, this.now); } catch (e) { this.db.close(); throw e; }
  }

  private readonly currentTemplates: TemplateReader = { get: (id, version) => this.getTemplate(id, version), list: () => this.listTemplates() };
  configurationRevision = 0;
  readonly listeners = new Set<() => void>();
  /** 在途资源读取用短期监听器撤销，避免相同 ID 删除后重建造成旧请求复活。 */
  readonly invalidationListeners = new Set<(kind: DocKind | 'repository', id: string) => void>();
  /** 在删除事务内同步执行，随文档一起提交或回滚。 */
  readonly documentDeleteHooks = new Set<(kind: DocKind, id: string) => void>();
  eventsClosed = false;
  closeEvents(): void { this.eventsClosed = true; this.changed(); }
  changed(): void { for (const listener of this.listeners) listener(); }
  get resourceCacheTtlSec(): number {
    const row = this.db.prepare("SELECT value FROM system_settings WHERE name = 'resourceCacheTtlSec'").get() as { value: string } | undefined;
    return row ? Number(row.value) : 86400;
  }
  setResourceCacheTtlSec(value: number): void {
    if (!Number.isSafeInteger(value) || value < 3600 || value > 8760 * 3600 || value % 3600) throw new Error('资源缓存时间必须为 1 至 8760 的整数小时');
    this.configurationRevision++;
    this.db.prepare("INSERT OR REPLACE INTO system_settings VALUES ('resourceCacheTtlSec', ?)").run(String(value));
    this.changed();
  }
  /** 含凭据的系统设置加密保存；只有持有主密钥才能读取。 */
  getSecureSetting<T>(name: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM system_settings WHERE name = ?').get(name) as { value: string } | undefined;
    return row ? JSON.parse(this.cipher.decrypt(row.value)) as T : undefined;
  }
  setSecureSetting(name: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO system_settings VALUES (?, ?)').run(name, this.cipher.encrypt(JSON.stringify(value)));
  }
  /** 规则快照身份：URL 加读取参数。behavior 只影响 MRS。读取权限在入口校验，不靠缓存隔离。 */
  ruleSnapshotKey(url: string, params: RuleFetchParams = {}): string {
    const format = params.format ?? 'auto';
    return this.cipher.hmac(JSON.stringify([url, { ua: params.ua ?? DEFAULT_UA, timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS, format, ...(format === 'mrs' ? { behavior: params.behavior } : {}) }]));
  }

  invalidateRepository(id: string): void {
    this.configurationRevision++;
    for (const listener of this.invalidationListeners) listener('repository', id);
    this.changed();
  }

  close(): void { this.closeEvents(); this.listeners.clear(); this.invalidationListeners.clear(); this.documentDeleteHooks.clear(); this.db.close(); }

  getProfileMigrationBackup(id: string): ProfileDoc | undefined {
    const row = this.db.prepare('SELECT data FROM profile_migration_backups WHERE profile_id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(this.readText(row.data)) as ProfileDoc : undefined;
  }

  // ---------- 文档 ----------

  /** owner 为 null 表示历史系统级文档，只在新建时写入，更新时保持原归属 */
  put<K extends DocKind>(kind: K, input: DocInputTypes[K], owner: string | null = null, templates: TemplateReader = this.currentTemplates): void {
    let doc = structuredClone(input) as DocTypes[K];
    stripResourceTiming(doc as unknown as Record<string, any>);
    if (kind === 'profile') doc = migrateProfile(doc as ProfileDoc, profileTemplate(doc as ProfileDoc, templates.get)) as DocTypes[K];
    if (kind === 'source') doc = normalizeSourceFetch(doc as SourceDoc) as DocTypes[K];
    this.db.transaction(() => {
      if (kind === 'profile' && !(input as ProfileDoc).routing) this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)')
        .run(input.id, JSON.stringify(input), this.now());
      this.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .run(kind, doc.id, owner, JSON.stringify(doc), this.now());

    })();
    this.configurationRevision++;
    if (kind === 'source' && typeof (doc as SourceDoc).url === 'string') this.deleteSourceSnapshots(doc.id, (doc as SourceDoc).url);
    this.changed();
  }

  get<K extends DocKind>(kind: K, id: string): DocTypes[K] | undefined {
    return this.getWithOwner(kind, id)?.doc;
  }

  getWithOwner<K extends DocKind>(kind: K, id: string): { doc: DocTypes[K]; owner: string | null; updatedAt: number } | undefined {
    const row = this.db.prepare('SELECT owner, data, updated_at FROM docs WHERE kind = ? AND id = ?').get(kind, id) as { owner: string | null; data: string; updated_at: number } | undefined;
    return row ? { doc: JSON.parse(this.readText(row.data)) as DocTypes[K], owner: row.owner, updatedAt: row.updated_at } : undefined;
  }

  /** owner 缺省时列出全部 */
  list<K extends DocKind>(kind: K, owner?: string): DocTypes[K][] {
    const rows = (owner === undefined
      ? this.db.prepare('SELECT data FROM docs WHERE kind = ? ORDER BY id').all(kind)
      : this.db.prepare('SELECT data FROM docs WHERE kind = ? AND owner = ? ORDER BY id').all(kind, owner)) as { data: string }[];
    return rows.map((r) => JSON.parse(this.readText(r.data)) as DocTypes[K]);
  }

  /** 无搜索时在数据库分页；名称在 JSON 正文内，搜索时先解析再筛选。 */
  private readPage<T extends { id: string; name?: string }>(sql: string, params: string[], options: PageOptions, decode: (data: string) => T): PageResult<T> {
    if (options.q) {
      const matches = (this.db.prepare(sql).all(...params) as { data: string }[])
        .map(row => decode(row.data)).filter(doc => matchesNameSearch(doc.name ?? doc.id, options.q));
      const meta = pageMeta(matches.length, options);
      return { ...meta, items: matches.slice((meta.page - 1) * meta.pageSize, meta.page * meta.pageSize) };
    }
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM (${sql})`).get(...params) as { total: number };
    const meta = pageMeta(total, options);
    const rows = this.db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, meta.pageSize, (meta.page - 1) * meta.pageSize) as { data: string }[];
    return { ...meta, items: rows.map(row => decode(row.data)) };
  }

  listPage<K extends DocKind>(kind: K, options: PageOptions, owner?: string): PageResult<DocTypes[K]> {
    return this.readPage(`SELECT data FROM docs WHERE kind = ?${owner === undefined ? '' : ' AND owner = ?'} ORDER BY id`,
      owner === undefined ? [kind] : [kind, owner], options, data => JSON.parse(this.readText(data)) as DocTypes[K]);
  }

  delete(kind: DocKind, id: string): boolean {
    this.configurationRevision++;
    const removed = this.db.transaction(() => {
      if (kind === 'source') {
        this.deleteSourceSnapshots(id);
        this.db.prepare('DELETE FROM source_shares WHERE source_id = ?').run(id);
      }
      const removed = this.db.prepare('DELETE FROM docs WHERE kind = ? AND id = ?').run(kind, id).changes > 0;
      for (const hook of this.documentDeleteHooks) hook(kind, id);
      if (kind === 'profile') this.deleteProfileData(id);
      return removed;
    })();
    for (const listener of this.invalidationListeners) listener(kind, id);
    return removed;
  }

  // ---------- 节点订阅分享 ----------

  /** 节点集是否可被该用户读取和引用：自己的，或分享给他的订阅源。组合和本地节点组不能分享。 */
  canUseNodeSet(type: 'source' | 'collection' | 'local', id: string, userId: string): boolean {
    const owner = this.getWithOwner(type, id)?.owner;
    if (owner === undefined) return false;
    return owner === userId || (type === 'source' && this.isSourceSharedWith(id, userId));
  }

  isSourceSharedWith(sourceId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM source_shares WHERE source_id = ? AND user_id = ?').get(sourceId, userId);
  }

  /** 列出某用户名下已分享的订阅源及其接收者。 */
  listSourceShares(owner: string): { id: string; name: string; to: string[] }[] {
    const rows = this.db.prepare('SELECT s.source_id AS id, s.user_id AS userId FROM source_shares s JOIN docs d ON d.kind = \'source\' AND d.id = s.source_id WHERE d.owner = ? ORDER BY s.source_id, s.created_at, s.user_id').all(owner) as { id: string; userId: string }[];
    const to = new Map<string, string[]>();
    for (const row of rows) to.set(row.id, [...(to.get(row.id) ?? []), row.userId]);
    return [...to].map(([id, users]) => ({ id, name: this.get('source', id)!.name, to: users }));
  }

  /** 整体替换接收者；空列表即取消分享。撤销后在途渲染按配置变化重试，不再下发节点。 */
  setSourceShares(sourceId: string, to: string[]): void {
    this.db.transaction(() => {
      const keep = new Set(to);
      const current = this.db.prepare('SELECT user_id FROM source_shares WHERE source_id = ?').all(sourceId) as { user_id: string }[];
      for (const { user_id } of current) if (!keep.has(user_id)) this.db.prepare('DELETE FROM source_shares WHERE source_id = ? AND user_id = ?').run(sourceId, user_id);
      for (const userId of keep) this.db.prepare('INSERT OR IGNORE INTO source_shares (source_id, user_id, created_at) VALUES (?, ?, ?)').run(sourceId, userId, this.now());
    })();
    this.configurationRevision++;
    this.changed();
  }

  private readonly readableSourcesSql = "SELECT data FROM docs WHERE kind = 'source' AND (owner = ? OR id IN (SELECT source_id FROM source_shares WHERE user_id = ?)) ORDER BY id";

  /** 自己的和分享给自己的订阅源，均为完整文档；返回接口前必须按归属脱敏。 */
  listReadableSources(userId: string): SourceDoc[] {
    return (this.db.prepare(this.readableSourcesSql).all(userId, userId) as { data: string }[]).map(row => JSON.parse(this.readText(row.data)) as SourceDoc);
  }

  listReadableSourcesPage(userId: string, options: PageOptions): PageResult<SourceDoc> {
    return this.readPage(this.readableSourcesSql, [userId, userId], options, data => JSON.parse(this.readText(data)) as SourceDoc);
  }

  // ---------- 当前模板 ----------

  putTemplate(t: TemplateVersionDoc): void {
    const { changelog: _changelog, version: _version, ...current } = t;
    this.db.prepare('INSERT INTO templates (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(t.id, JSON.stringify(current), this.now());
    this.configurationRevision++;
    this.changed();
  }

  /** 活动表不保留历史版本，带版本的锁定引用一律未命中。 */
  getTemplate(id: string, version?: number): TemplateVersionDoc | undefined {
    if (version !== undefined) return undefined;
    const row = this.db.prepare('SELECT data FROM templates WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  listTemplates(): TemplateVersionDoc[] {
    return (this.db.prepare('SELECT data FROM templates ORDER BY id').all() as { data: string }[]).map(row => JSON.parse(row.data));
  }

  listTemplatesPage(options: PageOptions): PageResult<TemplateVersionDoc> {
    return this.readPage('SELECT data FROM templates ORDER BY id', [], options, data => JSON.parse(data) as TemplateVersionDoc);
  }

  // ---------- 用户资源 token ----------

  /** 每个用户只有一个凭证；重复读取与普通文档保存不轮换。 */
  createToken(userId: string): TokenDoc & { createdAt: number } {
    if (!this.getUser(userId)) throw new Error('用户不存在');
    return this.db.transaction(() => {
      const existing = this.userToken(userId);
      if (existing) return existing;
      this.putToken({ token: randomId(32), userId });
      return this.userToken(userId)!;
    })();
  }

  putToken(t: TokenDoc): void {
    if (!this.getUser(t.userId)) throw new Error('用户不存在');
    this.db.transaction(() => {
      const existing = this.getToken(t.token);
      if (existing && existing.userId !== t.userId) throw new Error('令牌已被其他用户使用');
      this.db.prepare('INSERT INTO user_tokens (user_id, token_hash, token, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, token = excluded.token, created_at = excluded.created_at')
        .run(t.userId, this.cipher.hmac(t.token), t.token, this.now());
    })();
  }

  userToken(userId: string): (TokenDoc & { createdAt: number }) | undefined {
    const row = this.db.prepare('SELECT token, created_at FROM user_tokens WHERE user_id = ?').get(userId) as { token: string; created_at: number } | undefined;
    return row ? { token: this.readText(row.token), userId, createdAt: row.created_at } : undefined;
  }

  resetToken(token: string): (TokenDoc & { createdAt: number }) | undefined {
    return this.db.transaction(() => {
      const old = this.getToken(token);
      if (!old) return undefined;
      this.putToken({ token: randomId(32), userId: old.userId });
      return this.userToken(old.userId)!;
    })();
  }

  getToken(token: string): TokenDoc | undefined {
    const row = this.db.prepare('SELECT user_id FROM user_tokens WHERE token_hash = ?').get(this.cipher.hmac(token)) as { user_id: string } | undefined;
    return row ? { token, userId: row.user_id } : undefined;
  }

  getActiveToken(token: string): TokenDoc | undefined {
    const t = this.getToken(token);
    return t && this.getUser(t.userId)?.disabled === false ? t : undefined;
  }

  deleteToken(token: string): boolean {
    return this.db.prepare('DELETE FROM user_tokens WHERE token_hash = ?').run(this.cipher.hmac(token)).changes > 0;
  }

  /** 只删除订阅专属数据；用户凭证独立存在。 */
  deleteProfileData(profileId: string): void {
    this.db.transaction(() => {
      // 访问记录独立保留 30 天；删除资源不抹除用户自己的历史。
      this.db.prepare('DELETE FROM profile_migration_backups WHERE profile_id = ?').run(profileId);
    })();
  }


  // ---------- 快照 ----------

  addSnapshot(s: Omit<SnapshotRow, 'id'>): SnapshotRow {
    const urlHash = this.cipher.hmac(s.url);
    const tx = this.db.transaction(() => {
      const inserted = this.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, url_hash, fetched_at, ok, status, body, hash, userinfo, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.ownerKind, s.ownerId, s.url, urlHash, s.fetchedAt, s.ok ? 1 : 0, s.status ?? null, s.body === undefined ? null : s.body, s.hash ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, s.error === undefined ? null : s.error);
      // 每个身份只留最新成功内容和最新失败状态，换地址也不累积历史。
      this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND ok = ? AND id NOT IN (
        SELECT id FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND ok = ? ORDER BY fetched_at DESC, id DESC LIMIT 1)`)
        .run(s.ownerKind, s.ownerId, s.ok ? 1 : 0, s.ownerKind, s.ownerId, s.ok ? 1 : 0);
      return { ...s, id: Number(inserted.lastInsertRowid) };
    });
    return tx();
  }

  /** 删除订阅源的快照；keepUrl 用于修改 URL：只移除旧地址的内容。 */
  deleteSourceSnapshots(sourceId: string, keepUrl?: string): void {
    if (keepUrl === undefined) this.db.prepare("DELETE FROM snapshots WHERE owner_kind = 'source' AND owner_id = ?").run(sourceId);
    else this.db.prepare("DELETE FROM snapshots WHERE owner_kind = 'source' AND owner_id = ? AND url_hash <> ?").run(sourceId, this.cipher.hmac(keepUrl));
  }

  /** 规则快照到期立刻清理，不管有没有引用；读取路径也按周期判定，清理延迟不影响下发。 */
  deleteExpiredRuleSnapshots(cycleStart: number): number {
    return this.db.prepare("DELETE FROM snapshots WHERE owner_kind = 'ruleset' AND fetched_at < ?").run(cycleStart).changes;
  }

  /** 上游内容与最近一份成功快照相同：只更新拉取时间、状态码与流量信息，不新增一份，避免挤掉历史版本 */
  touchSnapshot(id: number, s: { fetchedAt: number; status?: number; userinfo?: TrafficInfo }): void {
    this.db.prepare('UPDATE snapshots SET fetched_at = ?, status = ?, userinfo = ? WHERE id = ?')
      .run(s.fetchedAt, s.status ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, id);
  }

  private toSnapshot(r: RawSnapshot): SnapshotRow {
    const s: SnapshotRow = { id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, url: this.readText(r.url), fetchedAt: r.fetched_at, ok: r.ok === 1 };
    if (r.status !== null) s.status = r.status;
    if (r.body !== null) s.body = this.readText(r.body);
    if (r.hash !== null) s.hash = r.hash;
    if (r.userinfo !== null) s.userinfo = JSON.parse(r.userinfo) as TrafficInfo;
    if (r.error !== null) s.error = this.readText(r.error);
    return s;
  }

  latestSnapshot(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): SnapshotRow | undefined {
    const row = this.db.prepare(`SELECT * FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as RawSnapshot | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  /** 只判断新旧和状态时使用：不读取、不解码正文。 */
  latestSnapshotMeta(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): Omit<SnapshotRow, 'body'> | undefined {
    const row = this.db.prepare(`SELECT id, owner_kind, owner_id, url, fetched_at, ok, status, NULL AS body, hash, userinfo, error FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as RawSnapshot | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  /** 快照历史（不含正文），供 UI 展示 */
  snapshotHistory(ownerKind: SnapshotOwner, ownerId: string): Omit<SnapshotRow, 'body'>[] {
    const rows = this.db.prepare('SELECT id, owner_kind, owner_id, url, fetched_at, ok, status, NULL AS body, hash, userinfo, error FROM snapshots WHERE owner_kind = ? AND owner_id = ? ORDER BY fetched_at DESC, id DESC')
      .all(ownerKind, ownerId) as RawSnapshot[];
    const result=rows.map((r) => this.toSnapshot(r));
    if(ownerKind !== 'source')return result;
    const source=this.get('source',ownerId);
    const current=source ? result.filter(row=>row.url===source.url) : result;
    return current.filter((row,index)=>current.findIndex(r=>r.ok===row.ok)===index);
  }

  countSnapshots(ownerKind: SnapshotOwner, ownerId: string, url: string): { ok: number; failed: number } {
    const row = this.db.prepare('SELECT SUM(ok = 1) ok, SUM(ok = 0) failed FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ?')
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as { ok: number | null; failed: number | null };
    return { ok: row.ok ?? 0, failed: row.failed ?? 0 };
  }

  // ---------- 访问日志 ----------

  /** token 只记录 HMAC 前 8 位，日志里不出现可用的订阅地址 */
  logAccess(r: AccessLogRow & { kind?: AccessKind; resourceId?: string; resourceName?: string; method?: string }): void {
    const user = this.getActiveToken(r.token);
    if (!user) return;
    this.db.prepare('INSERT INTO access_log (token, profile_id, at, ua, client, platform, status, ms, warnings, source, user_id, kind, resource_id, resource_name, method, client_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.cipher.hmac(r.token).slice(0, 8), r.profileId, r.at, r.ua.replaceAll(r.token, '[令牌]').slice(0, 512), r.client, r.platform ?? null, r.status, r.ms, r.warnings, r.source,
        user.userId, r.kind ?? 'subscription', (r.resourceId ?? r.profileId).replaceAll(r.token, '[令牌]').slice(0, 512), (r.resourceName ?? '').replaceAll(r.token, '[令牌]').slice(0, 200), r.method ?? 'GET', r.clientIp ?? null);
  }

  userAccessPage(userId: string, options: PageOptions, kind?: AccessKind): PageResult<UserAccessLogRow> {
    const where = 'user_id = ? AND at >= ?' + (kind ? ' AND kind = ?' : '');
    const args = [userId, this.now() - 30 * 86400_000, ...(kind ? [kind] : [])];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${where}`).get(...args) as { n: number }).n;
    const meta = pageMeta(total, options);
    const rows = this.db.prepare(`SELECT id, profile_id AS profileId, at, ua, client, platform, status, ms, warnings, source, kind, resource_id AS resourceId, resource_name AS resourceName, method, client_ip AS clientIp FROM access_log WHERE ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, meta.pageSize, (meta.page - 1) * meta.pageSize) as UserAccessLogRow[];
    return { ...meta, items: rows };
  }

  recentAccess(profileId: string, limit = 50): AccessLogRow[] {
    const rows = this.db.prepare("SELECT token, profile_id, at, ua, client, platform, status, ms, warnings, source, client_ip AS clientIp FROM access_log WHERE profile_id = ? AND kind = 'subscription' ORDER BY at DESC, id DESC LIMIT ?")
      .all(profileId, limit) as ({ clientIp: string | null; token: string; profile_id: string; at: number; ua: string; client: string; platform: string | null; status: number; ms: number; warnings: number; source: string })[];
    return rows.map((r) => {
      const row: AccessLogRow = { token: r.token, profileId: r.profile_id, at: r.at, ua: r.ua, client: r.client, status: r.status, ms: r.ms, warnings: r.warnings, source: r.source, clientIp: r.clientIp };
      if (r.platform !== null) row.platform = r.platform;
      return row;
    });
  }

  /** 访问日志保留 30 天（非功能需求：数据保留） */
  pruneAccessLog(maxAgeMs = 30 * 86400_000): number {
    return this.db.prepare('DELETE FROM access_log WHERE at < ?').run(this.now() - maxAgeMs).changes;
  }

  // ---------- 用户与会话 ----------

  createUser(u: { username: string; passwordHash: string; role: Role; scriptAllowed?: boolean }): User {
    const id = randomId(9);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO users (id, username, password_hash, role, script_allowed, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, u.username, u.passwordHash, u.role, u.scriptAllowed ? 1 : 0, this.now());
      this.createToken(id);
    })();
    return this.getUser(id)!;
  }

  getUser(id: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUser | undefined;
    return r ? toUser(r) : undefined;
  }

  getUserAuth(username: string): (User & { passwordHash: string }) | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as RawUser | undefined;
    return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined;
  }

  listUsers(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at, rowid').all() as RawUser[]).map(toUser);
  }

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  }

  updateUser(id: string, patch: { role?: Role; disabled?: boolean; scriptAllowed?: boolean; passwordHash?: string }): void {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.role !== undefined) { sets.push('role = ?'); args.push(patch.role); }
    if (patch.disabled !== undefined) { sets.push('disabled = ?'); args.push(patch.disabled ? 1 : 0); }
    if (patch.scriptAllowed !== undefined) { sets.push('script_allowed = ?'); args.push(patch.scriptAllowed ? 1 : 0); }
    if (patch.passwordHash !== undefined) { sets.push('password_hash = ?'); args.push(patch.passwordHash); }
    if (!sets.length) return;
    this.configurationRevision++;
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  createSession(userId: string, ttlMs: number): string {
    const sid = randomId(32);
    const now = this.now();
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(this.cipher.hmac(sid), userId, now, now + ttlMs);
    return sid;
  }

  /** 会话有效且用户未被禁用时返回用户 */
  getSessionUser(sid: string): User | undefined {
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').get(this.cipher.hmac(sid)) as { user_id: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= this.now()) return undefined;
    const u = this.getUser(row.user_id);
    return u && !u.disabled ? u : undefined;
  }

  deleteSession(sid: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(this.cipher.hmac(sid));
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // ---------- 种子 ----------

  /** owner：有归属的文档写入到该用户名下（缺省为无归属） */
  importSeed(seed: Seed, owner: string | null = null): void {
    importSeedDocuments(this, seed, owner, this.now);
  }
}
