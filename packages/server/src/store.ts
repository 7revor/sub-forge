// SQLite 存储。只保存"意图"（文档）与上游原始快照，不保存渲染结果；
// 唯一例外是每个 Profile 最近一次成功的渲染结果，用于失败时兜底（OUT-05 / TPL-12）。

import Database from 'better-sqlite3';
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

/** 每个 (来源, URL) 保留的成功快照份数（非功能需求：数据保留） */
const KEEP_OK_SNAPSHOTS = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
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
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL
);
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
`;

type RawSnapshot = {
  id: number; owner_kind: SnapshotOwner; owner_id: string; url: string; fetched_at: number;
  ok: number; status: number | null; body: string | null; hash: string | null; userinfo: string | null; error: string | null;
};

function toSnapshot(r: RawSnapshot): SnapshotRow {
  const s: SnapshotRow = { id: r.id, ownerKind: r.owner_kind, ownerId: r.owner_id, url: r.url, fetchedAt: r.fetched_at, ok: r.ok === 1 };
  if (r.status !== null) s.status = r.status;
  if (r.body !== null) s.body = r.body;
  if (r.hash !== null) s.hash = r.hash;
  if (r.userinfo !== null) s.userinfo = JSON.parse(r.userinfo) as TrafficInfo;
  if (r.error !== null) s.error = r.error;
  return s;
}

export class Store {
  readonly db: Database.Database;

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void { this.db.close(); }

  // ---------- 文档 ----------

  put<K extends DocKind>(kind: K, doc: DocTypes[K]): void {
    this.db.prepare('INSERT INTO docs (kind, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(kind, doc.id, JSON.stringify(doc), this.now());
  }

  get<K extends DocKind>(kind: K, id: string): DocTypes[K] | undefined {
    const row = this.db.prepare('SELECT data FROM docs WHERE kind = ? AND id = ?').get(kind, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as DocTypes[K]) : undefined;
  }

  list<K extends DocKind>(kind: K): DocTypes[K][] {
    const rows = this.db.prepare('SELECT data FROM docs WHERE kind = ? ORDER BY id').all(kind) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as DocTypes[K]);
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

  // ---------- token ----------

  putToken(t: TokenDoc): void {
    this.db.prepare('INSERT INTO tokens (token, profile_id, label, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET profile_id = excluded.profile_id, label = excluded.label')
      .run(t.token, t.profileId, t.label ?? null, this.now());
  }

  getToken(token: string): TokenDoc | undefined {
    const row = this.db.prepare('SELECT token, profile_id, label FROM tokens WHERE token = ?').get(token) as { token: string; profile_id: string; label: string | null } | undefined;
    if (!row) return undefined;
    return row.label === null ? { token: row.token, profileId: row.profile_id } : { token: row.token, profileId: row.profile_id, label: row.label };
  }

  // ---------- 快照 ----------

  addSnapshot(s: Omit<SnapshotRow, 'id'>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, fetched_at, ok, status, body, hash, userinfo, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(s.ownerKind, s.ownerId, s.url, s.fetchedAt, s.ok ? 1 : 0, s.status ?? null, s.body ?? null, s.hash ?? null, s.userinfo ? JSON.stringify(s.userinfo) : null, s.error ?? null);
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

  latestSnapshot(ownerKind: SnapshotOwner, ownerId: string, url: string, okOnly = true): SnapshotRow | undefined {
    const row = this.db.prepare(`SELECT * FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ? ${okOnly ? 'AND ok = 1' : ''} ORDER BY fetched_at DESC, id DESC LIMIT 1`)
      .get(ownerKind, ownerId, url) as RawSnapshot | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  countSnapshots(ownerKind: SnapshotOwner, ownerId: string, url: string): { ok: number; failed: number } {
    const row = this.db.prepare('SELECT SUM(ok = 1) ok, SUM(ok = 0) failed FROM snapshots WHERE owner_kind = ? AND owner_id = ? AND url = ?')
      .get(ownerKind, ownerId, url) as { ok: number | null; failed: number | null };
    return { ok: row.ok ?? 0, failed: row.failed ?? 0 };
  }

  // ---------- 最近一次成功的渲染 ----------

  putLastGood(profileId: string, target: string, data: unknown): void {
    this.db.prepare('INSERT INTO last_good (profile_id, target, rendered_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (profile_id, target) DO UPDATE SET rendered_at = excluded.rendered_at, data = excluded.data')
      .run(profileId, target, this.now(), JSON.stringify(data));
  }

  getLastGood<T>(profileId: string, target: string): { renderedAt: number; data: T } | undefined {
    const row = this.db.prepare('SELECT rendered_at, data FROM last_good WHERE profile_id = ? AND target = ?').get(profileId, target) as { rendered_at: number; data: string } | undefined;
    return row ? { renderedAt: row.rendered_at, data: JSON.parse(row.data) as T } : undefined;
  }

  // ---------- 访问日志 ----------

  logAccess(r: AccessLogRow): void {
    this.db.prepare('INSERT INTO access_log (token, profile_id, at, ua, client, platform, status, ms, warnings, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.token, r.profileId, r.at, r.ua, r.client, r.platform ?? null, r.status, r.ms, r.warnings, r.source);
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

  // ---------- 种子 ----------

  importSeed(seed: Seed): void {
    const tx = this.db.transaction(() => {
      for (const d of seed.sources ?? []) this.put('source', d);
      for (const d of seed.collections ?? []) this.put('collection', d);
      for (const d of seed.locals ?? []) this.put('local', d);
      for (const d of seed.rulesets ?? []) this.put('ruleset', d);
      for (const d of seed.bundles ?? []) this.put('bundle', d);
      for (const d of seed.presets ?? []) this.put('preset', d);
      for (const d of seed.profiles ?? []) this.put('profile', d);
      for (const t of seed.templates ?? []) {
        this.db.prepare('DELETE FROM template_versions WHERE template_id = ? AND version = ?').run(t.id, t.version);
        this.putTemplateVersion(t);
      }
      for (const t of seed.tokens ?? []) this.putToken(t);
    });
    tx();
  }
}
