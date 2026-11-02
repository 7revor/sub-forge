import { importSeedDocuments, migrateDatabase } from './store-migrations.ts';
import { ruleBinding } from './rule-binding.ts';
import { resolveRuleSetReference, usableRuleSet } from './ruleset-reference.ts';
import { findRuleFile } from './rule-repos/options.ts';
import { Report, resolveProfileRouting, stableStringify } from '@sub-forge/core';
import type { ClientAddress } from './net/client-ip.ts';
import { migrateProfile, profileTemplate } from './profile-routing.ts';
// SQLite 存储。保存文档、快照与最近一次成功的渲染结果。
// 文档正文、快照 URL/正文/错误、订阅 token 均加密落盘（SYS-04）。

import Database from 'better-sqlite3';
import { pageMeta, type PageOptions, type PageResult } from './pagination.ts';
import { matchesNameSearch, normalizeNameSearch } from '@sub-forge/core';
import { randomBytes } from 'node:crypto';
import { Cipher, randomId } from './crypto.ts';
import type { DocKind, DocTypes, DocInputTypes, ProfileDoc, RuleSetDoc, Seed, SourceDoc, TemplateVersionDoc, TokenDoc } from './docs.ts';
import { normalizeSourceFetch, stripResourceTiming } from './source-url.ts';

export type SnapshotOwner = 'source' | 'ruleset';

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

export type AccessLogRow = Partial<ClientAddress> & {
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

/** 规则集每个 URL 保留的成功快照份数；订阅源只保留最近一次成功。 */
const KEEP_OK_SNAPSHOTS = 1;

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

  constructor(path: string, opts: StoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    if (!opts.cipher && path !== ':memory:') throw new Error('持久化数据库必须提供加密密钥');
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
  /** 相同权限、地址与读取参数共享一份成功原文。绑定不改变文档归属。 */
  resourceKey(kind: SnapshotOwner, id: string, url: string, options: unknown, scope?: string): string {
    const owner = scope ?? this.getWithOwner(kind, id)?.owner ?? `reference:${id}`;
    return 'resource:' + this.cipher.hmac(JSON.stringify([kind, owner, url, options]));
  }
  resourceBinding(kind: SnapshotOwner, id: string, url: string): string | undefined {
    return (this.db.prepare('SELECT resource FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').get(kind, id, this.cipher.hmac(url)) as { resource: string } | undefined)?.resource;
  }
  bindResource(kind: SnapshotOwner, id: string, url: string, options: unknown, scope?: string, migrateLegacy = true): string {
    const resource = this.resourceKey(kind, id, url, options, scope);
    const urlHash = this.cipher.hmac(url);
    const prior = this.db.prepare('SELECT resource FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').get(kind,id,urlHash) as { resource: string } | undefined;
    if (prior?.resource === resource) return resource;
    // 旧快照只在首次绑定时迁移；参数变化不能沿用旧读取身份的正文。
    if (!prior && migrateLegacy) {
      for (const ok of [true, false]) {
        const legacy = this.latestSnapshot(kind,id,url,ok);
        const current = this.latestSnapshot(kind,resource,url,ok);
        if (legacy && (!current || legacy.fetchedAt > current.fetchedAt)) this.addSnapshot({ ...legacy, ownerId: resource });
      }
      this.db.prepare('DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ?').run(kind,id,urlHash);
    }
    this.db.prepare('INSERT OR REPLACE INTO resource_bindings VALUES (?, ?, ?, ?)').run(kind,id,urlHash,resource);
    if (prior && prior.resource !== resource) this.pruneUnusedResource(prior.resource);
    return resource;
  }
  pruneUnusedResource(resource: string): void {
    if (resource.startsWith('resource:') && !this.db.prepare('SELECT 1 FROM resource_bindings WHERE resource = ? LIMIT 1').get(resource)) {
      this.db.prepare('DELETE FROM snapshots WHERE owner_id = ?').run(resource);
    }
  }
  private dropResourceBindings(kind: SnapshotOwner, id: string, urls: string[] = []): void {
    const keep = new Set(urls.map(url => this.cipher.hmac(url)));
    for (const row of this.db.prepare('SELECT DISTINCT url_hash FROM snapshots WHERE owner_kind = ? AND owner_id = ?').all(kind, id) as { url_hash: string }[]) {
      if (!keep.has(row.url_hash)) this.db.prepare('DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ?').run(kind, id, row.url_hash);
    }
    const rows = this.db.prepare('SELECT url_hash, resource FROM resource_bindings WHERE kind = ? AND id = ?').all(kind,id) as {url_hash:string;resource:string}[];
    for (const row of rows) {
      if (keep.has(row.url_hash)) continue;
      this.db.prepare('DELETE FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').run(kind,id,row.url_hash);
      this.pruneUnusedResource(row.resource);
    }
  }
  pruneResourceBindings(templates: TemplateReader = this.currentTemplates): void {
    const keep = new Map<string, Set<string>>();
    const add = (kind: string, id: string, urls: string[]) => {
      const key = `${kind}:${id}`;
      const hashes = keep.get(key) ?? new Set<string>();
      urls.forEach(url => hashes.add(this.cipher.hmac(url))); keep.set(key, hashes);
    };
    const walk = (value: unknown, context?: string): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(item => walk(item, context)); return; }
      const v = value as Record<string, any>;
      if (v.kind === 'ruleset' && typeof v.id === 'string') {
        if (v.remote?.url && context) add('ruleset', ruleBinding(v.id, context).id, [v.remote.url]);
        if (v.repository?.sources && resolveRuleSetReference(v as import('./ruleset-reference.ts').RuleSetMatcher, this)) add('ruleset', v.id, v.repository.sources.flatMap((s: { url?: string }) => s.url ? [s.url] : []));
      }
      Object.values(v).forEach(item => walk(item, context));
    };
    // 只有这三类文档持有资源地址；本地节点组可能很大，不必解密。
    for (const row of this.db.prepare("SELECT kind,id,data FROM docs WHERE kind IN ('source','ruleset','profile')").all() as {kind:string;id:string;data:string}[]) {
      const doc = JSON.parse(this.cipher.decrypt(row.data));
      if (row.kind === 'source' && doc.url) add('source', row.id, [doc.url]);
      if (row.kind === 'ruleset' && usableRuleSet(doc, this)) add('ruleset', row.id, (doc.sources ?? []).flatMap((s: {url?:string}) => s.url ? [s.url] : []));
      if (row.kind === 'profile') {
        walk(doc, `profile:${row.id}`);
        const template = profileTemplate(doc, templates.get);
        if (template) walk(template, `profile:${row.id}`);
      }
    }
    templates.list().forEach(t => walk(t, `template:${t.id}`));
    for (const row of this.db.prepare('SELECT * FROM resource_bindings').all() as { kind: string; id: string; url_hash: string; resource: string }[]) {
      // 仓库正文由索引缓存维护，其生命周期不取决于配置订阅。
      if (row.id.startsWith('repository-file:')) {
        const match = /^repository-file:([^:]+):([^:]+):(.+)$/.exec(row.id);
        if (match && this.db.prepare('SELECT 1 FROM rule_repos WHERE id = ? AND enabled = 1').get(match[1]!) && findRuleFile(this.db, match[1]!, match[2]!, match[3]!)) continue;
      } else if (keep.get(`${row.kind}:${row.id}`)?.has(row.url_hash)) continue;
      this.db.prepare('DELETE FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').run(row.kind, row.id, row.url_hash);
      this.pruneUnusedResource(row.resource);
    }
    this.db.exec("DELETE FROM snapshots WHERE owner_id LIKE 'resource:%' AND owner_id NOT IN (SELECT resource FROM resource_bindings)");
  }

  invalidateRepository(id: string): void {
    this.configurationRevision++;
    this.pruneResourceBindings();
    for (const listener of this.invalidationListeners) listener('repository', id);
    this.changed();
  }

  private snapshotOwner(kind: SnapshotOwner, id: string, url: string): string {
    return (this.db.prepare('SELECT resource FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').get(kind,id,this.cipher.hmac(url)) as {resource:string}|undefined)?.resource ?? id;
  }
  close(): void { this.closeEvents(); this.listeners.clear(); this.invalidationListeners.clear(); this.documentDeleteHooks.clear(); this.db.close(); }

  getProfileMigrationBackup(id: string): ProfileDoc | undefined {
    const row = this.db.prepare('SELECT data FROM profile_migration_backups WHERE profile_id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc : undefined;
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
        .run(input.id, this.cipher.encrypt(JSON.stringify(input)), this.now());
      this.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .run(kind, doc.id, owner, this.cipher.encrypt(JSON.stringify(doc)), this.now());

    })();
    this.configurationRevision++;
    if (kind === 'source' && typeof (doc as SourceDoc).url === 'string') this.dropResourceBindings('source',doc.id,[(doc as SourceDoc).url]);
    if (kind === 'ruleset' && Array.isArray((doc as RuleSetDoc).sources)) this.dropResourceBindings('ruleset',doc.id,(doc as RuleSetDoc).sources.flatMap(s=>s.kind==='remote' && s.url ? [s.url] : []));
    this.pruneResourceBindings(templates);
    this.changed();
  }

  get<K extends DocKind>(kind: K, id: string): DocTypes[K] | undefined {
    return this.getWithOwner(kind, id)?.doc;
  }

  getWithOwner<K extends DocKind>(kind: K, id: string): { doc: DocTypes[K]; owner: string | null; updatedAt: number } | undefined {
    const row = this.db.prepare('SELECT owner, data, updated_at FROM docs WHERE kind = ? AND id = ?').get(kind, id) as { owner: string | null; data: string; updated_at: number } | undefined;
    return row ? { doc: JSON.parse(this.cipher.decrypt(row.data)) as DocTypes[K], owner: row.owner, updatedAt: row.updated_at } : undefined;
  }

  /** owner 缺省时列出全部 */
  list<K extends DocKind>(kind: K, owner?: string): DocTypes[K][] {
    const rows = (owner === undefined
      ? this.db.prepare('SELECT data FROM docs WHERE kind = ? ORDER BY id').all(kind)
      : this.db.prepare('SELECT data FROM docs WHERE kind = ? AND owner = ? ORDER BY id').all(kind, owner)) as { data: string }[];
    return rows.map((r) => JSON.parse(this.cipher.decrypt(r.data)) as DocTypes[K]);
  }

  /** 无搜索时在数据库分页；名称在加密正文内，搜索必须先解密再筛选。 */
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
      owner === undefined ? [kind] : [kind, owner], options, data => JSON.parse(this.cipher.decrypt(data)) as DocTypes[K]);
  }

  delete(kind: DocKind, id: string): boolean {
    this.configurationRevision++;
    const removed = this.db.transaction(() => {
      if (kind === 'source' || kind === 'ruleset') this.dropResourceBindings(kind,id);
      const removed = this.db.prepare('DELETE FROM docs WHERE kind = ? AND id = ?').run(kind, id).changes > 0;
      for (const hook of this.documentDeleteHooks) hook(kind, id);
      if (kind === 'profile') this.deleteProfileData(id);
      this.pruneResourceBindings();
      return removed;
    })();
    for (const listener of this.invalidationListeners) listener(kind, id);
    return removed;
  }

  // ---------- 当前模板 ----------

  putTemplate(t: TemplateVersionDoc): void {
    const { changelog: _changelog, version: _version, ...current } = t;
    this.db.prepare('INSERT INTO templates (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(t.id, JSON.stringify(current), this.now());
    this.configurationRevision++;
    this.pruneResourceBindings();
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
      this.db.prepare('INSERT INTO user_tokens (user_id, token_hash, token_enc, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, token_enc = excluded.token_enc, created_at = excluded.created_at')
        .run(t.userId, this.cipher.hmac(t.token), this.cipher.encrypt(t.token), this.now());
    })();
  }

  userToken(userId: string): (TokenDoc & { createdAt: number }) | undefined {
    const row = this.db.prepare('SELECT token_enc, created_at FROM user_tokens WHERE user_id = ?').get(userId) as { token_enc: string; created_at: number } | undefined;
    return row ? { token: this.cipher.decrypt(row.token_enc), userId, createdAt: row.created_at } : undefined;
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
    s = { ...s, ownerId:this.snapshotOwner(s.ownerKind,s.ownerId,s.url) };
    const urlHash = this.cipher.hmac(s.url);
    const tx = this.db.transaction(() => {
      const inserted = this.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, url_hash, fetched_at, ok, status, body, hash, userinfo, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.ownerKind, s.ownerId, this.cipher.encrypt(s.url), urlHash, s.fetchedAt, s.ok ? 1 : 0, s.status ?? null, s.body === undefined ? null : this.cipher.encrypt(s.body), s.hash ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, s.error === undefined ? null : this.cipher.encrypt(s.error));
      const row = { ...s, id: Number(inserted.lastInsertRowid) };
      if (s.ownerKind === 'source') {
        // 一个订阅源只留最新成功内容和最新失败状态，换地址也不累积历史。
        this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = 'source' AND owner_id = ? AND ok = ? AND id NOT IN (
          SELECT id FROM snapshots WHERE owner_kind = 'source' AND owner_id = ? AND ok = ? ORDER BY fetched_at DESC, id DESC LIMIT 1)`)
          .run(s.ownerId, s.ok ? 1 : 0, s.ownerId, s.ok ? 1 : 0);
        return row;
      }
      // 规则集成功快照保留最近 N 份；失败记录只保留最新一条
      this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? AND ok = 1 AND id NOT IN (
        SELECT id FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? AND ok = 1 ORDER BY fetched_at DESC, id DESC LIMIT ?)`)
        .run(s.ownerKind, s.ownerId, urlHash, s.ownerKind, s.ownerId, urlHash, KEEP_OK_SNAPSHOTS);
      this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? AND ok = 0 AND id NOT IN (
        SELECT id FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? AND ok = 0 ORDER BY fetched_at DESC, id DESC LIMIT 1)`)
        .run(s.ownerKind, s.ownerId, urlHash, s.ownerKind, s.ownerId, urlHash);
      return row;
    });
    return tx();
  }

  /** 上游内容与最近一份成功快照相同：只更新拉取时间、状态码与流量信息，不新增一份，避免挤掉历史版本 */
  touchSnapshot(id: number, s: { fetchedAt: number; status?: number; userinfo?: TrafficInfo }): void {
    this.db.prepare('UPDATE snapshots SET fetched_at = ?, status = ?, userinfo = ? WHERE id = ?')
      .run(s.fetchedAt, s.status ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, id);
  }

  private toSnapshot(r: RawSnapshot): SnapshotRow {
    const s: SnapshotRow = { id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, url: this.cipher.decrypt(r.url), fetchedAt: r.fetched_at, ok: r.ok === 1 };
    if (r.status !== null) s.status = r.status;
    if (r.body !== null) s.body = this.cipher.decrypt(r.body);
    if (r.hash !== null) s.hash = r.hash;
    if (r.userinfo !== null) s.userinfo = JSON.parse(r.userinfo) as TrafficInfo;
    if (r.error !== null) s.error = this.cipher.decrypt(r.error);
    return s;
  }

  latestSnapshot(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): SnapshotRow | undefined {
    ownerId = this.snapshotOwner(ownerKind, ownerId, url);
    const row = this.db.prepare(`SELECT * FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as RawSnapshot | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  /** 只判断新旧和状态时使用：不读取、不解码正文。 */
  latestSnapshotMeta(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): Omit<SnapshotRow, 'body'> | undefined {
    ownerId = this.snapshotOwner(ownerKind, ownerId, url);
    const row = this.db.prepare(`SELECT id, owner_kind, owner_id, url, fetched_at, ok, status, NULL AS body, hash, userinfo, error FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as RawSnapshot | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  /** 快照历史（不含正文），供 UI 展示 */
  snapshotHistory(ownerKind: SnapshotOwner, ownerId: string): Omit<SnapshotRow, 'body'>[] {
    const rows = this.db.prepare('SELECT id, owner_kind, owner_id, url, fetched_at, ok, status, NULL AS body, hash, userinfo, error FROM snapshots WHERE owner_kind = ? AND (owner_id = ? OR owner_id IN (SELECT resource FROM resource_bindings WHERE kind = ? AND id = ?)) ORDER BY fetched_at DESC, id DESC')
      .all(ownerKind, ownerId, ownerKind, ownerId) as RawSnapshot[];
    const result=rows.map((r) => this.toSnapshot(r));
    if(ownerKind !== 'source')return result;
    const source=this.get('source',ownerId);
    const current=source ? result.filter(row=>row.url===source.url) : result;
    return current.filter((row,index)=>current.findIndex(r=>r.ok===row.ok)===index);
  }

  countSnapshots(ownerKind: SnapshotOwner, ownerId: string, url: string): { ok: number; failed: number } {
    ownerId = this.snapshotOwner(ownerKind, ownerId, url);
    const row = this.db.prepare('SELECT SUM(ok = 1) ok, SUM(ok = 0) failed FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url_hash = ?')
      .get(ownerKind, ownerId, this.cipher.hmac(url)) as { ok: number | null; failed: number | null };
    return { ok: row.ok ?? 0, failed: row.failed ?? 0 };
  }

  // ---------- 访问日志 ----------

  /** token 只记录 HMAC 前 8 位，日志里不出现可用的订阅地址 */
  logAccess(r: AccessLogRow & { kind?: AccessKind; resourceId?: string; resourceName?: string; method?: string }): void {
    const user = this.getActiveToken(r.token);
    if (!user) return;
    this.db.prepare('INSERT INTO access_log (token, profile_id, at, ua, client, platform, status, ms, warnings, source, user_id, kind, resource_id, resource_name, method, client_ip, peer_ip, ip_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.cipher.hmac(r.token).slice(0, 8), r.profileId, r.at, r.ua.replaceAll(r.token, '[令牌]').slice(0, 512), r.client, r.platform ?? null, r.status, r.ms, r.warnings, r.source,
        user.userId, r.kind ?? 'subscription', (r.resourceId ?? r.profileId).replaceAll(r.token, '[令牌]').slice(0, 512), (r.resourceName ?? '').replaceAll(r.token, '[令牌]').slice(0, 200), r.method ?? 'GET', r.clientIp ?? null, r.peerIp ?? null, r.ipSource ?? 'unknown');
  }

  userAccessPage(userId: string, options: PageOptions, kind?: AccessKind): PageResult<UserAccessLogRow> {
    const where = 'user_id = ? AND at >= ?' + (kind ? ' AND kind = ?' : '');
    const args = [userId, this.now() - 30 * 86400_000, ...(kind ? [kind] : [])];
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${where}`).get(...args) as { n: number }).n;
    const meta = pageMeta(total, options);
    const rows = this.db.prepare(`SELECT id, profile_id AS profileId, at, ua, client, platform, status, ms, warnings, source, kind, resource_id AS resourceId, resource_name AS resourceName, method, client_ip AS clientIp, peer_ip AS peerIp, ip_source AS ipSource FROM access_log WHERE ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, meta.pageSize, (meta.page - 1) * meta.pageSize) as UserAccessLogRow[];
    return { ...meta, items: rows };
  }

  recentAccess(profileId: string, limit = 50): AccessLogRow[] {
    const rows = this.db.prepare("SELECT token, profile_id, at, ua, client, platform, status, ms, warnings, source, client_ip AS clientIp, peer_ip AS peerIp, ip_source AS ipSource FROM access_log WHERE profile_id = ? AND kind = 'subscription' ORDER BY at DESC, id DESC LIMIT ?")
      .all(profileId, limit) as (ClientAddress & { token: string; profile_id: string; at: number; ua: string; client: string; platform: string | null; status: number; ms: number; warnings: number; source: string })[];
    return rows.map((r) => {
      const row: AccessLogRow = { token: r.token, profileId: r.profile_id, at: r.at, ua: r.ua, client: r.client, status: r.status, ms: r.ms, warnings: r.warnings, source: r.source, clientIp: r.clientIp, peerIp: r.peerIp, ipSource: r.ipSource };
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
