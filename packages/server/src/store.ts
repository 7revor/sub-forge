// SQLite 存储。只保存"意图"（文档）与上游原始快照，不保存渲染结果；
// 唯一例外是每个 Profile 最近一次成功的渲染结果，用于失败时兜底（OUT-05 / TPL-12）。
// 文档正文、快照正文、订阅 token 均加密落盘（SYS-04）。

import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { Cipher, randomId } from './crypto.ts';
import type { DocKind, DocTypes, Seed, TemplateVersionDoc, TokenDoc } from './docs.ts';

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

export type AccessLogRow = {
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

/** 每个 (来源, URL) 保留的成功快照份数（非功能需求：数据保留） */
const KEEP_OK_SNAPSHOTS = 5;
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS docs_owner ON docs (kind, owner);
CREATE TABLE IF NOT EXISTS template_versions (
  template_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, version)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, url TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER,
  body TEXT, hash TEXT, userinfo TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_owner ON snapshots (owner_kind, owner_id, url, fetched_at);
CREATE TABLE IF NOT EXISTS sub_tokens (
  token_hash TEXT PRIMARY KEY, token_enc TEXT NOT NULL, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sub_tokens_profile ON sub_tokens (profile_id);
CREATE TABLE IF NOT EXISTS last_good (
  profile_id TEXT NOT NULL, target TEXT NOT NULL, rendered_at INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (profile_id, target)
);
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL, profile_id TEXT NOT NULL, at INTEGER NOT NULL, ua TEXT NOT NULL,
  client TEXT NOT NULL, platform TEXT, status INTEGER NOT NULL, ms INTEGER NOT NULL,
  warnings INTEGER NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS access_log_profile ON access_log (profile_id, at);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0, script_allowed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
`;

type RawSnapshot = {
  id: number; owner_kind: SnapshotOwner; owner_id: string; url: string; fetched_at: number;
  ok: number; status: number | null; body: string | null; hash: string | null; userinfo: string | null; error: string | null;
};

type RawUser = { id: string; username: string; password_hash: string; role: Role; disabled: number; script_allowed: number; created_at: number };

const toUser = (r: RawUser): User => ({ id: r.id, username: r.username, role: r.role, disabled: r.disabled === 1, scriptAllowed: r.script_allowed === 1, createdAt: r.created_at });

/** 有归属的文档种类；模板与预设由管理员维护，所有人可读 */
export const OWNED_KINDS = ['source', 'collection', 'local', 'ruleset', 'bundle', 'profile'] as const;

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
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void { this.db.close(); }

  /** 旧版数据库（v1：docs 无 owner、token 明文）升级到当前结构 */
  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version >= SCHEMA_VERSION) return;
    const tx = this.db.transaction(() => {
      const hasDocs = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get();
      if (hasDocs) {
        const cols = (this.db.prepare('PRAGMA table_info(docs)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('owner')) this.db.exec('ALTER TABLE docs ADD COLUMN owner TEXT');
      }
      this.db.exec(SCHEMA);
      const hasV1Tokens = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tokens'").get();
      if (hasV1Tokens) {
        const rows = this.db.prepare('SELECT token, profile_id, label, created_at FROM tokens').all() as { token: string; profile_id: string; label: string | null; created_at: number }[];
        for (const r of rows) {
          this.db.prepare('INSERT OR REPLACE INTO sub_tokens (token_hash, token_enc, profile_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(this.cipher.hmac(r.token), this.cipher.encrypt(r.token), r.profile_id, r.label, r.created_at);
        }
        this.db.exec('DROP TABLE tokens');
      }
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    tx();
  }

  // ---------- 文档 ----------

  /** owner 为 null 表示系统级文档（预设等），只在新建时写入，更新时保持原归属 */
  put<K extends DocKind>(kind: K, doc: DocTypes[K], owner: string | null = null): void {
    this.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(kind, doc.id, owner, this.cipher.encrypt(JSON.stringify(doc)), this.now());
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

  delete(kind: DocKind, id: string): boolean {
    return this.db.prepare('DELETE FROM docs WHERE kind = ? AND id = ?').run(kind, id).changes > 0;
  }

  // ---------- 模板版本 ----------

  putTemplateVersion(t: TemplateVersionDoc): void {
    this.db.prepare('INSERT INTO template_versions (template_id, version, data, created_at) VALUES (?, ?, ?, ?)')
      .run(t.id, t.version, JSON.stringify(t), this.now());
  }

  /** version 缺省时取最新版本（跟随最新，TPL-06） */
  getTemplate(id: string, version?: number): TemplateVersionDoc | undefined {
    const row = (version === undefined
      ? this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1').get(id)
      : this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? AND version = ?').get(id, version)) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as TemplateVersionDoc) : undefined;
  }

  listTemplateVersions(id: string): { version: number; changelog?: string; createdAt: number }[] {
    const rows = this.db.prepare('SELECT version, data, created_at FROM template_versions WHERE template_id = ? ORDER BY version DESC').all(id) as { version: number; data: string; created_at: number }[];
    return rows.map((r) => {
      const t = JSON.parse(r.data) as TemplateVersionDoc;
      return t.changelog ? { version: r.version, changelog: t.changelog, createdAt: r.created_at } : { version: r.version, createdAt: r.created_at };
    });
  }

  /** 每个模板的最新版本 */
  listLatestTemplates(): TemplateVersionDoc[] {
    const rows = this.db.prepare(`SELECT t.data FROM template_versions t
      JOIN (SELECT template_id, MAX(version) v FROM template_versions GROUP BY template_id) m ON m.template_id = t.template_id AND m.v = t.version
      ORDER BY t.template_id`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as TemplateVersionDoc);
  }

  // ---------- 订阅 token ----------

  createToken(profileId: string, label?: string): TokenDoc {
    const token = randomId();
    this.putToken(label === undefined ? { token, profileId } : { token, profileId, label });
    return label === undefined ? { token, profileId } : { token, profileId, label };
  }

  putToken(t: TokenDoc): void {
    this.db.prepare('INSERT INTO sub_tokens (token_hash, token_enc, profile_id, label, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO UPDATE SET profile_id = excluded.profile_id, label = excluded.label')
      .run(this.cipher.hmac(t.token), this.cipher.encrypt(t.token), t.profileId, t.label ?? null, this.now());
  }

  getToken(token: string): TokenDoc | undefined {
    const row = this.db.prepare('SELECT profile_id, label FROM sub_tokens WHERE token_hash = ?').get(this.cipher.hmac(token)) as { profile_id: string; label: string | null } | undefined;
    if (!row) return undefined;
    return row.label === null ? { token, profileId: row.profile_id } : { token, profileId: row.profile_id, label: row.label };
  }

  listTokens(profileId: string): (TokenDoc & { createdAt: number })[] {
    const rows = this.db.prepare('SELECT token_enc, label, created_at FROM sub_tokens WHERE profile_id = ? ORDER BY created_at, token_hash').all(profileId) as { token_enc: string; label: string | null; created_at: number }[];
    return rows.map((r) => {
      const base = { token: this.cipher.decrypt(r.token_enc), profileId, createdAt: r.created_at };
      return r.label === null ? base : { ...base, label: r.label };
    });
  }

  deleteToken(token: string): boolean {
    return this.db.prepare('DELETE FROM sub_tokens WHERE token_hash = ?').run(this.cipher.hmac(token)).changes > 0;
  }

  deleteProfileData(profileId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM sub_tokens WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM last_good WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM access_log WHERE profile_id = ?').run(profileId);
    });
    tx();
  }

  // ---------- 快照 ----------

  addSnapshot(s: Omit<SnapshotRow, 'id'>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, fetched_at, ok, status, body, hash, userinfo, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.ownerKind, s.ownerId, s.url, s.fetchedAt, s.ok ? 1 : 0, s.status ?? null, s.body === undefined ? null : this.cipher.encrypt(s.body), s.hash ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, s.error ?? null);
      // 成功快照保留最近 N 份；失败记录只保留最新一条（用于 UI 标红）
      this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? AND ok = 1 AND id NOT IN (
        SELECT id FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? AND ok = 1 ORDER BY fetched_at DESC, id DESC LIMIT ?)`)
        .run(s.ownerKind, s.ownerId, s.url, s.ownerKind, s.ownerId, s.url, KEEP_OK_SNAPSHOTS);
      this.db.prepare(`DELETE FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? AND ok = 0 AND id NOT IN (
        SELECT id FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? AND ok = 0 ORDER BY fetched_at DESC, id DESC LIMIT 1)`)
        .run(s.ownerKind, s.ownerId, s.url, s.ownerKind, s.ownerId, s.url);
    });
    tx();
  }

  private toSnapshot(r: RawSnapshot): SnapshotRow {
    const s: SnapshotRow = { id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, url: r.url, fetchedAt: r.fetched_at, ok: r.ok === 1 };
    if (r.status !== null) s.status = r.status;
    if (r.body !== null) s.body = this.cipher.decrypt(r.body);
    if (r.hash !== null) s.hash = r.hash;
    if (r.userinfo !== null) s.userinfo = JSON.parse(r.userinfo) as TrafficInfo;
    if (r.error !== null) s.error = r.error;
    return s;
  }

  latestSnapshot(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): SnapshotRow | undefined {
    const row = this.db.prepare(`SELECT * FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, url) as RawSnapshot | undefined;
    return row ? this.toSnapshot(row) : undefined;
  }

  /** 快照历史（不含正文），供 UI 展示 */
  snapshotHistory(ownerKind: SnapshotOwner, ownerId: string): Omit<SnapshotRow, 'body'>[] {
    const rows = this.db.prepare('SELECT id, owner_kind, owner_id, url, fetched_at, ok, status, NULL AS body, hash, userinfo, error FROM snapshots WHERE owner_kind = ? AND owner_id = ? ORDER BY fetched_at DESC, id DESC')
      .all(ownerKind, ownerId) as RawSnapshot[];
    return rows.map((r) => this.toSnapshot(r));
  }

  countSnapshots(ownerKind: SnapshotOwner, ownerId: string, url: string): { ok: number; failed: number } {
    const row = this.db.prepare('SELECT SUM(ok = 1) ok, SUM(ok = 0) failed FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ?')
      .get(ownerKind, ownerId, url) as { ok: number | null; failed: number | null };
    return { ok: row.ok ?? 0, failed: row.failed ?? 0 };
  }

  // ---------- 最近一次成功的渲染 ----------

  putLastGood(profileId: string, target: string, data: unknown): void {
    this.db.prepare('INSERT INTO last_good (profile_id, target, rendered_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (profile_id, target) DO UPDATE SET rendered_at = excluded.rendered_at, data = excluded.data')
      .run(profileId, target, this.now(), this.cipher.encrypt(JSON.stringify(data)));
  }

  getLastGood<T>(profileId: string, target: string): { renderedAt: number; data: T } | undefined {
    const row = this.db.prepare('SELECT rendered_at, data FROM last_good WHERE profile_id = ? AND target = ?').get(profileId, target) as { rendered_at: number; data: string } | undefined;
    return row ? { renderedAt: row.rendered_at, data: JSON.parse(this.cipher.decrypt(row.data)) as T } : undefined;
  }

  // ---------- 访问日志 ----------

  /** token 只记录 HMAC 前 8 位，日志里不出现可用的订阅地址 */
  logAccess(r: AccessLogRow): void {
    this.db.prepare('INSERT INTO access_log (token, profile_id, at, ua, client, platform, status, ms, warnings, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.cipher.hmac(r.token).slice(0, 8), r.profileId, r.at, r.ua, r.client, r.platform ?? null, r.status, r.ms, r.warnings, r.source);
  }

  recentAccess(profileId: string, limit = 50): AccessLogRow[] {
    const rows = this.db.prepare('SELECT token, profile_id, at, ua, client, platform, status, ms, warnings, source FROM access_log WHERE profile_id = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(profileId, limit) as { token: string; profile_id: string; at: number; ua: string; client: string; platform: string | null; status: number; ms: number; warnings: number; source: string }[];
    return rows.map((r) => {
      const row: AccessLogRow = { token: r.token, profileId: r.profile_id, at: r.at, ua: r.ua, client: r.client, status: r.status, ms: r.ms, warnings: r.warnings, source: r.source };
      if (r.platform !== null) row.platform = r.platform;
      return row;
    });
  }

  /** 访问日志保留 30 天（非功能需求：数据保留） */
  pruneAccessLog(maxAgeMs = 30 * 86400_000): number {
    return this.db.prepare('DELETE FROM access_log WHERE at < ?').run(this.now() - maxAgeMs).changes;
  }

  // ---------- 用户与会话 ----------

  createUser(u: { username: string; passwordHash: string; role: Role }): User {
    const id = randomId(9);
    this.db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, u.username, u.passwordHash, u.role, this.now());
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
    const tx = this.db.transaction(() => {
      for (const d of seed.sources ?? []) this.put('source', d, owner);
      for (const d of seed.collections ?? []) this.put('collection', d, owner);
      for (const d of seed.locals ?? []) this.put('local', d, owner);
      for (const d of seed.rulesets ?? []) this.put('ruleset', d, owner);
      for (const d of seed.bundles ?? []) this.put('bundle', d, owner);
      for (const d of seed.presets ?? []) this.put('preset', d);
      for (const d of seed.profiles ?? []) this.put('profile', d, owner);
      for (const t of seed.templates ?? []) {
        this.db.prepare('DELETE FROM template_versions WHERE template_id = ? AND version = ?').run(t.id, t.version);
        this.putTemplateVersion(t);
      }
      for (const t of seed.tokens ?? []) this.putToken(t);
    });
    tx();
  }
}
