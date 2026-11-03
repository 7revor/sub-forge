// 当前数据库结构。旧版结构的转换见 store-migrations.ts。

export const SCHEMA_VERSION = 35;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS native_migration_backups (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS system_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rule_repos (
  id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, built_at INTEGER, checked_at INTEGER,
  revisions TEXT NOT NULL DEFAULT '{}', error TEXT, definition TEXT, indexed_definition TEXT
);
CREATE TABLE IF NOT EXISTS rule_repo_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rule_repo_entries (
  repo TEXT NOT NULL, key TEXT NOT NULL, search_name TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (repo, key)
);
CREATE TABLE IF NOT EXISTS rule_repo_catalog (
  repo TEXT PRIMARY KEY, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS docs_owner ON docs (kind, owner);
CREATE TABLE IF NOT EXISTS profile_migration_backups (
  profile_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, url TEXT NOT NULL, url_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER,
  body TEXT, hash TEXT, userinfo TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_owner ON snapshots (owner_kind, owner_id, url_hash, fetched_at);
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, token TEXT NOT NULL, created_at INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS refresh_jobs (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL
);
`;
