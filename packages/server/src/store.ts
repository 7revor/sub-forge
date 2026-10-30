import type { ClientAddress } from './net/client-ip.ts';
import { normalizeRulePresence } from './rule-presence.ts';
import { migrateProfile, profileTemplate, stripProfileRevisions } from './profile-routing.ts';
// SQLite 存储。保存文档、快照与最近成功的配置版本；旧客户端按版本取兼容资源。
// 文档正文、快照 URL/正文/错误、订阅 token 均加密落盘（SYS-04）。

import Database from 'better-sqlite3';
import { pageMeta, type PageOptions, type PageResult } from './pagination.ts';
import { matchesNameSearch, normalizeNameSearch, exactNameRegex, NodeSetResolver, type ChainRule, type LocalProxy, type Profile, type Target } from '@sub-forge/core';
import { randomBytes } from 'node:crypto';
import { Cipher, randomId } from './crypto.ts';
import type { DocKind, DocTypes, ProfileDoc, LocalDoc, RuleSetDoc, Seed, SourceDoc, TemplateVersionDoc, TokenDoc } from './docs.ts';
import { normalizeSourceFetch, sourceUrl } from './source-url.ts';
import { convertBundles, normalizeRuleSet, promoteRuleSetOverrides, retargetBundleRefs } from './legacy-rules.ts';

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
const SCHEMA_VERSION = 25;
/** 每个 Profile/客户端保留最近 32 个结构版本；节点内容刷新不增加版本数。 */
const KEEP_RENDER_GENERATIONS = 32;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS system_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resource_bindings (kind TEXT NOT NULL, id TEXT NOT NULL, url_hash TEXT NOT NULL, resource TEXT NOT NULL, PRIMARY KEY(kind,id,url_hash));
CREATE INDEX IF NOT EXISTS resource_bindings_resource ON resource_bindings (resource);
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
CREATE TABLE IF NOT EXISTS template_versions (
  template_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, version)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, url TEXT NOT NULL, url_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER,
  body TEXT, hash TEXT, userinfo TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_owner ON snapshots (owner_kind, owner_id, url_hash, fetched_at);
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_rule_resources (
  key TEXT PRIMARY KEY, ruleset_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_rule_resources_ruleset ON shared_rule_resources (ruleset_id);
CREATE TABLE IF NOT EXISTS sub_tokens (
  token_hash TEXT PRIMARY KEY, token_enc TEXT NOT NULL, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sub_tokens_profile ON sub_tokens (profile_id);
CREATE TABLE IF NOT EXISTS last_good (
  profile_id TEXT NOT NULL, target TEXT NOT NULL, rendered_at INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (profile_id, target)
);
CREATE TABLE IF NOT EXISTS render_generations (
  profile_id TEXT NOT NULL, target TEXT NOT NULL, version TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (profile_id, target, version)
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
export const OWNED_KINDS = ['source', 'collection', 'local', 'ruleset', 'profile'] as const;

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
    try { this.migrate(); } catch (e) { this.db.close(); throw e; }
  }

  configurationRevision = 0;
  readonly listeners = new Set<() => void>();
  /** 在途资源读取用短期监听器撤销，避免相同 ID 删除后重建造成旧请求复活。 */
  readonly invalidationListeners = new Set<(kind: DocKind | 'shared-rule', id: string) => void>();
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
  pruneResourceBindings(): void {
    const keep = new Map<string, Set<string>>();
    const add = (kind: string, id: string, urls: string[]) => {
      const key = `${kind}:${id}`;
      const hashes = keep.get(key) ?? new Set<string>();
      urls.forEach(url => hashes.add(this.cipher.hmac(url))); keep.set(key, hashes);
    };
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(walk); return; }
      const v = value as Record<string, any>;
      if (v.kind === 'ruleset' && typeof v.id === 'string') {
        if (v.remote?.url) add('ruleset', v.id, [v.remote.url]);
        if (v.repository?.sources) add('ruleset', v.id, v.repository.sources.flatMap((s: { url?: string }) => s.url ? [s.url] : []));
      }
      Object.values(v).forEach(walk);
    };
    for (const row of this.db.prepare('SELECT kind,id,data FROM docs').all() as {kind:string;id:string;data:string}[]) {
      const doc = JSON.parse(this.cipher.decrypt(row.data));
      if (row.kind === 'source' && doc.url) add('source', row.id, [doc.url]);
      if (row.kind === 'ruleset') add('ruleset', row.id, (doc.sources ?? []).flatMap((s: {url?:string}) => s.url ? [s.url] : []));
      if (row.kind === 'profile') walk(doc);
    }
    this.listLatestTemplates().forEach(walk);
    this.listSharedRules<unknown>().forEach(r => walk(r.data));
    for (const row of this.db.prepare('SELECT * FROM resource_bindings').all() as { kind: string; id: string; url_hash: string; resource: string }[]) {
      // 仓库正文由索引缓存维护，其生命周期不取决于配置订阅。
      if (row.id.startsWith('repository-file:') || keep.get(`${row.kind}:${row.id}`)?.has(row.url_hash)) continue;
      this.db.prepare('DELETE FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').run(row.kind, row.id, row.url_hash);
      this.pruneUnusedResource(row.resource);
    }
    this.db.exec("DELETE FROM snapshots WHERE owner_id LIKE 'resource:%' AND owner_id NOT IN (SELECT resource FROM resource_bindings)");
  }

  private snapshotOwner(kind: SnapshotOwner, id: string, url: string): string {
    return (this.db.prepare('SELECT resource FROM resource_bindings WHERE kind = ? AND id = ? AND url_hash = ?').get(kind,id,this.cipher.hmac(url)) as {resource:string}|undefined)?.resource ?? id;
  }
  close(): void { this.closeEvents(); this.listeners.clear(); this.invalidationListeners.clear(); this.db.close(); }

  /** 旧版数据库升级到当前结构（v1：docs 无 owner、token 明文；v4 及以前：订阅源可以是本地内容；v5 及以前：本地节点可以设置前置；v6 及以前：规则集单一来源、另有规则包；v7：客户端改写绑定来源；v8 及以前：订阅地址可能保存在 urls 数组） */
  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version >= SCHEMA_VERSION) return;
    const hadSnapshots = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'snapshots'").get();
    const tx = this.db.transaction(() => {
      const hasDocs = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get();
      if (hasDocs) {
        const cols = (this.db.prepare('PRAGMA table_info(docs)').all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes('owner')) this.db.exec('ALTER TABLE docs ADD COLUMN owner TEXT');
      }
      if (hadSnapshots && version < 3) {
        const cols = this.db.prepare('PRAGMA table_info(snapshots)').all() as { name: string }[];
        if (!cols.some((c) => c.name === 'url_hash')) this.db.exec('ALTER TABLE snapshots ADD COLUMN url_hash TEXT');
        this.db.exec('DROP INDEX IF EXISTS snapshots_owner');
      }
      this.db.exec(SCHEMA);
      const repoCols = this.db.prepare('PRAGMA table_info(rule_repos)').all() as { name: string }[];
      if (!repoCols.some(c => c.name === 'definition')) this.db.exec('ALTER TABLE rule_repos ADD COLUMN definition TEXT');
      if (!repoCols.some(c => c.name === 'indexed_definition')) this.db.exec('ALTER TABLE rule_repos ADD COLUMN indexed_definition TEXT');
      // v1/v2 允许旧明文文档；本次迁移一并加密，URL 改用 HMAC 查询，错误中也可能包含 URL。
      if (version < 3) {
        for (const r of this.db.prepare('SELECT id, url, body, error FROM snapshots').all() as { id: number; url: string; body: string | null; error: string | null }[]) {
          const url = this.cipher.decrypt(r.url);
          this.db.prepare('UPDATE snapshots SET url = ?, url_hash = ?, body = ?, error = ? WHERE id = ?').run(
            this.cipher.encrypt(url), this.cipher.hmac(url),
            r.body === null ? null : this.cipher.encrypt(this.cipher.decrypt(r.body)),
            r.error === null ? null : this.cipher.encrypt(this.cipher.decrypt(r.error)), r.id);
        }
        for (const table of ['docs', 'last_good'] as const) {
          for (const r of this.db.prepare(`SELECT rowid, data FROM ${table}`).all() as { rowid: number; data: string }[]) {
            this.db.prepare(`UPDATE ${table} SET data = ? WHERE rowid = ?`).run(this.cipher.encrypt(this.cipher.decrypt(r.data)), r.rowid);
          }
        }
      }
      const hasV1Tokens = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tokens'").get();
      if (hasV1Tokens) {
        const rows = this.db.prepare('SELECT token, profile_id, label, created_at FROM tokens').all() as { token: string; profile_id: string; label: string | null; created_at: number }[];
        for (const r of rows) {
          this.db.prepare('INSERT OR REPLACE INTO sub_tokens (token_hash, token_enc, profile_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(this.cipher.hmac(r.token), this.cipher.encrypt(r.token), r.profile_id, r.label, r.created_at);
        }
        this.db.exec('DROP TABLE tokens');
      }
      if (hasDocs && version < 5) this.convertLocalSources();
      if (hasDocs && version < 6) this.moveLocalDialers();
      if (hasDocs && version < 7) this.convertRuleBundles();
      if (hasDocs && version < 9) {
        // 两条开发分支曾分别使用 v8；在 v9 幂等执行两项转换，兼容任一分支已升级的数据库。
        this.promoteRuleOverrides();
        this.convertSourceUrls();
      }
      if (version < 15) {
        // v15：订阅源固定拉取选项；兼容主干及开发分支曾各自使用的 v14。
        // 保留归属、更新时间及最近成功内容，规则集不变。
        for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'source'").all() as { id: string; data: string }[]) {
          const source = JSON.parse(this.cipher.decrypt(row.data)) as SourceDoc;
          this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'source' AND id = ?")
            .run(this.cipher.encrypt(JSON.stringify(normalizeSourceFetch(source))), row.id);
        }
        this.db.exec(`DELETE FROM snapshots WHERE owner_kind = 'source' AND id NOT IN (
          SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id, ok ORDER BY fetched_at DESC, id DESC) AS position
            FROM snapshots WHERE owner_kind = 'source') WHERE position = 1)`);
      }
      // v14：移除 GitHub API 凭据；不触碰订阅令牌或未知的其他服务凭据。
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'server_secrets'").get()) {
        this.db.prepare("DELETE FROM server_secrets WHERE name = 'github-index-token'").run();
        if (!this.db.prepare('SELECT 1 FROM server_secrets LIMIT 1').get()) this.db.exec('DROP TABLE server_secrets');
      }
      if (hasDocs && version < 16) {
        for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
          const previous = JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc;
          if (previous.routing) continue;
          const migrated = migrateProfile(previous, profileTemplate(previous, (id, v) => this.getTemplate(id, v)));
          this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)')
            .run(row.id, this.cipher.encrypt(JSON.stringify(previous)), this.now());
          // 不触碰归属、更新时间、订阅链接、成功配置及历史资源。
          this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'profile' AND id = ?").run(this.cipher.encrypt(JSON.stringify(migrated)), row.id);
        }
      }
      // v18 同时清除规则集和规则引用上的独立 no-resolve，保留原始内容中的标记。
      if (version < 18) this.removeRuleSwitches();
      if (version < 19) this.collapseTemplateHistory();
      if (version < 20) this.removeConcurrencyMarkers();
      if (version < 21) {
        this.db.exec(`DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_kind, owner_id, url_hash, ok ORDER BY fetched_at DESC, id DESC) AS position FROM snapshots) WHERE position = 1)`);
        for (const row of this.db.prepare('SELECT kind,id,data FROM docs').all() as {kind:string;id:string;data:string}[]) {
          const doc = JSON.parse(this.cipher.decrypt(row.data));
          this.stripResourceTiming(doc);
          this.db.prepare('UPDATE docs SET data = ? WHERE kind = ? AND id = ?').run(this.cipher.encrypt(JSON.stringify(doc)),row.kind,row.id);
        }
      }
      if (version < 22) {
        // 每个订阅保留最早的链接；同一时间按原列表顺序决定，重复迁移不换链接。
        this.db.exec(`DELETE FROM sub_tokens WHERE token_hash NOT IN (SELECT token_hash FROM (
          SELECT token_hash, ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY created_at, token_hash) AS position FROM sub_tokens
        ) WHERE position = 1)`);
        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sub_tokens_one_per_profile ON sub_tokens (profile_id)');

      }
      if (version < 23) {
        // 不能把仅能访问某个订阅的旧凭证升级为用户全部私有资源的通行证。
        for (const user of this.listUsers()) this.createToken(user.id);
        this.db.exec('DROP TABLE sub_tokens; DELETE FROM last_good; DELETE FROM render_generations;');
        this.pruneResourceBindings();
      }
      if (version < 24) {
        const columns = new Set((this.db.prepare('PRAGMA table_info(access_log)').all() as { name: string }[]).map(column => column.name));
        for (const [name, definition] of Object.entries({ user_id: 'TEXT', kind: "TEXT NOT NULL DEFAULT 'subscription'", resource_id: "TEXT NOT NULL DEFAULT ''", resource_name: "TEXT NOT NULL DEFAULT ''", method: "TEXT NOT NULL DEFAULT 'GET'" })) {
          if (!columns.has(name)) this.db.exec(`ALTER TABLE access_log ADD COLUMN ${name} ${definition}`);
        }
        // 旧日志只有截断的 token 摘要，不能可靠确定访问者；保留原记录，不猜测用户归属。
        this.db.exec('CREATE INDEX IF NOT EXISTS access_log_user_time ON access_log (user_id, at DESC, id DESC); CREATE INDEX IF NOT EXISTS access_log_user_kind ON access_log (user_id, kind, at DESC, id DESC)');
      }
      if (version < 25) {
        const columns = new Set((this.db.prepare('PRAGMA table_info(access_log)').all() as { name: string }[]).map(column => column.name));
        for (const [name, definition] of Object.entries({ client_ip: 'TEXT', peer_ip: 'TEXT', ip_source: "TEXT NOT NULL DEFAULT 'unknown'" })) {
          if (!columns.has(name)) this.db.exec(`ALTER TABLE access_log ADD COLUMN ${name} ${definition}`);
        }
      }
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    tx();
    // secure_delete 清除旧凭据所在记录，截断本次迁移前的 WAL。
    if (version < 23) this.db.pragma('wal_checkpoint(TRUNCATE)');
    if (hadSnapshots && version < 3) {
      // 清除迁移前留在空闲页和 WAL 中的明文副本。
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    }
  }

  /** v8：来源改写提升为组级内容匹配，远程行号只依据已有成功快照转换。 */
  private promoteRuleOverrides(): void {
    for (const rs of this.list('ruleset')) {
      const next = promoteRuleSetOverrides(rs, (src) => src.url ? this.latestSnapshot('ruleset', rs.id, src.url)?.body : undefined);
      if (JSON.stringify(next) !== JSON.stringify(rs)) {
        this.db.prepare("UPDATE docs SET data = ?, updated_at = ? WHERE kind = 'ruleset' AND id = ?")
          .run(this.cipher.encrypt(JSON.stringify(next)), this.now(), rs.id);
      }
    }
  }

  /**
   * 订阅源去掉了「本地内容」：旧的本地内容订阅源转成同 id、同归属的本地节点组。
   * 节点按原处理链跑完后的结果保存（本地节点组没有处理链），组合与 Profile 中的引用改指向本地节点组。
   */
  private convertLocalSources(): void {
    const rows = this.db.prepare("SELECT id, owner, data FROM docs WHERE kind = 'source'").all() as { id: string; owner: string | null; data: string }[];
    const moved = new Set<string>();
    for (const r of rows) {
      const src = JSON.parse(this.cipher.decrypt(r.data)) as Record<string, unknown>;
      if (src.kind !== 'local') continue;
      const { kind: _kind, content, ...rest } = src;
      const id = r.id;
      const resolver = new NodeSetResolver({
        sources: { [id]: { ...(rest as { name: string; pipeline: [] }), id, url: 'local' } },
        collections: {}, locals: {}, snapshots: { [id]: [typeof content === 'string' ? content : ''] },
      });
      const nodes = resolver.resolve({ type: 'source', id });
      for (const item of resolver.report.items) console.warn(`[迁移] 本地内容订阅源「${String(src.name)}」转为本地节点组：${item.message}`);
      const proxies = nodes.map(({ _source, _origName, _key, dialer, upstreamDialer, ...p }) => {
        // 处理链改过名，上游自带前置按原名指向同组节点时换成新名
        const via = upstreamDialer && (nodes.find((x) => x._origName === upstreamDialer)?.name ?? upstreamDialer);
        return { ...p, ...(via ? { 'dialer-proxy': via } : {}) } as LocalProxy;
      });
      const group: LocalDoc = { id, name: String(src.name), proxies };
      this.db.prepare("DELETE FROM docs WHERE kind = 'source' AND id = ?").run(id);
      this.db.prepare("INSERT OR REPLACE INTO docs (kind, id, owner, data, updated_at) VALUES ('local', ?, ?, ?, ?)")
        .run(id, r.owner, this.cipher.encrypt(JSON.stringify(group)), this.now());
      moved.add(id);
    }
    if (!moved.size) return;
    const retarget = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(retarget);
      if (!v || typeof v !== 'object') return v;
      const o = v as Record<string, unknown>;
      if (o.type === 'source' && typeof o.id === 'string' && moved.has(o.id) && Object.keys(o).length === 2) return { type: 'local', id: o.id };
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, retarget(x)]));
    };
    for (const r of this.db.prepare("SELECT rowid, data FROM docs WHERE kind IN ('collection', 'local', 'profile')").all() as { rowid: number; data: string }[]) {
      const before = this.cipher.decrypt(r.data);
      const after = JSON.stringify(retarget(JSON.parse(before)));
      if (after !== before) this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(after), r.rowid);
    }
  }

  /** 单地址旧文档无损升级，意外多地址数据拒绝迁移，事务回滚保留原数据。 */
  private convertSourceUrls(): void {
    for (const row of this.db.prepare("SELECT rowid, data FROM docs WHERE kind = 'source'").all() as { rowid: number; data: string }[]) {
      const raw = JSON.parse(this.cipher.decrypt(row.data)) as Record<string, unknown>;
      const { urls: _, ...rest } = raw;
      const next = { ...rest, url: sourceUrl(raw) };
      this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(JSON.stringify(next)), row.rowid);
    }
  }

  /**
   * 本地节点不再设置前置（代理链只在配置订阅中管理）：节点上的前置改写成直接加入了该分组的配置订阅里的链规则，
   * 落地按节点名精确匹配。只经组合间接用到该分组的配置订阅无法按名称可靠匹配，跳过并告警，需要用户重新配置。
   */
  private moveLocalDialers(): void {
    const locals = (this.db.prepare("SELECT rowid, id, data FROM docs WHERE kind = 'local'").all() as { rowid: number; id: string; data: string }[])
      .map((r) => ({ ...r, doc: JSON.parse(this.cipher.decrypt(r.data)) as LocalDoc }));
    const profiles = (this.db.prepare("SELECT rowid, data FROM docs WHERE kind = 'profile'").all() as { rowid: number; data: string }[])
      .map((r) => ({ rowid: r.rowid, doc: JSON.parse(this.cipher.decrypt(r.data)) as Profile, changed: false }));
    for (const l of locals) {
      const moved: { name: string; via: Target }[] = [];
      let changed = false;
      const proxies = l.doc.proxies.map((p) => {
        const { dialer, 'dialer-proxy': dp, 'underlying-proxy': up, ...rest } = p as LocalProxy & { dialer?: Target };
        if (dialer === undefined && dp === undefined && up === undefined) return p;
        changed = true;
        const name = typeof dp === 'string' && dp ? dp : typeof up === 'string' && up ? up : undefined;
        if (dialer) moved.push({ name: p.name, via: dialer });
        else if (name && l.doc.proxies.some((x) => x.name === name)) moved.push({ name: p.name, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: l.id }, match: { exact: name } } } });
        else if (name) console.warn(`[迁移] 本地节点组「${l.doc.name}」的节点「${p.name}」前置「${name}」不在同一分组，无法转成链规则，已移除，请在配置订阅的「代理链」中重新设置`);
        return rest as LocalProxy;
      });
      if (!changed) continue;
      this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(JSON.stringify({ ...l.doc, proxies })), l.rowid);
      if (!moved.length) continue;
      let used = false;
      for (const pr of profiles) {
        if (!pr.doc.nodeSets?.some((n) => n.ref.type === 'local' && n.ref.id === l.id)) continue;
        used = true;
        const chains: ChainRule[] = moved.map((m) => ({ id: `c_${randomId(8)}`, landing: { nodeSet: { type: 'local', id: l.id }, filter: exactNameRegex(m.name) }, via: m.via }));
        pr.doc = { ...pr.doc, chains: [...(pr.doc.chains ?? []), ...chains] };
        pr.changed = true;
      }
      if (!used) console.warn(`[迁移] 本地节点组「${l.doc.name}」的 ${moved.length} 个前置没有直接加入它的配置订阅可承接，已移除；经组合使用时请在配置订阅的「代理链」中重新设置`);
    }
    for (const pr of profiles) if (pr.changed) this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(JSON.stringify(pr.doc)), pr.rowid);
  }

  /**
   * 规则包并入规则集：旧规则集转成多来源结构；规则包转成同归属的规则集（id 冲突时换新 id），
   * 远程来源的快照复制到新规则集名下，模板与 Profile 中的规则包引用改指向新规则集。
   */
  private convertRuleBundles(): void {
    const rulesets = new Map<string, RuleSetDoc>();
    for (const r of this.db.prepare("SELECT rowid, id, data FROM docs WHERE kind = 'ruleset'").all() as { rowid: number; id: string; data: string }[]) {
      const raw = JSON.parse(this.cipher.decrypt(r.data)) as Record<string, unknown>;
      const next = normalizeRuleSet(raw);
      if (next) this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(JSON.stringify(next)), r.rowid);
      rulesets.set(r.id, next ?? (raw as unknown as RuleSetDoc));
    }
    const rows = this.db.prepare("SELECT id, owner, data FROM docs WHERE kind = 'bundle'").all() as { id: string; owner: string | null; data: string }[];
    if (!rows.length) return;
    const owners = new Map(rows.map((r) => [r.id, r.owner]));
    const converted = convertBundles(rows.map((r) => JSON.parse(this.cipher.decrypt(r.data))), rulesets, new Set(rulesets.keys()), () => randomId(9),
      (message) => console.warn(`[迁移] ${message}`));
    for (const rs of converted.rulesets) {
      const bundleId = [...converted.idMap].find(([, to]) => to === rs.id)![0];
      this.db.prepare("INSERT INTO docs (kind, id, owner, data, updated_at) VALUES ('ruleset', ?, ?, ?, ?)")
        .run(rs.id, owners.get(bundleId) ?? null, this.cipher.encrypt(JSON.stringify(rs)), this.now());
    }
    for (const c of converted.snapshotCopies) {
      this.db.prepare(`INSERT INTO snapshots (owner_kind, owner_id, url, url_hash, fetched_at, ok, status, body, hash, userinfo, error)
        SELECT owner_kind, ?, url, url_hash, fetched_at, ok, status, body, hash, userinfo, error FROM snapshots WHERE owner_kind = 'ruleset' AND owner_id = ? AND url_hash = ?`)
        .run(c.to, c.from, this.cipher.hmac(c.url));
    }
    this.db.prepare("DELETE FROM docs WHERE kind = 'bundle'").run();
    for (const r of this.db.prepare("SELECT rowid, data FROM docs WHERE kind = 'profile'").all() as { rowid: number; data: string }[]) {
      const before = this.cipher.decrypt(r.data);
      const after = JSON.stringify(retargetBundleRefs(JSON.parse(before), converted.idMap));
      if (after !== before) this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(after), r.rowid);
    }
    for (const r of this.db.prepare('SELECT rowid, data FROM template_versions').all() as { rowid: number; data: string }[]) {
      const after = JSON.stringify(retargetBundleRefs(JSON.parse(r.data), converted.idMap));
      if (after !== r.data) this.db.prepare('UPDATE template_versions SET data = ? WHERE rowid = ?').run(after, r.rowid);
    }
  }

  getProfileMigrationBackup(id: string): ProfileDoc | undefined {
    const row = this.db.prepare('SELECT data FROM profile_migration_backups WHERE profile_id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc : undefined;
  }

  /** 在原事务内移除停用项，保留归属、更新时间、版本、令牌与历史渲染资源。 */
  private removeRuleSwitches(): void {
    for (const row of this.db.prepare("SELECT rowid, kind, data FROM docs WHERE kind IN ('ruleset', 'profile')").all() as { rowid: number; kind: string; data: string }[]) {
      const original = this.cipher.decrypt(row.data);
      let document = JSON.parse(original);
      if (row.kind === 'profile' && !document.routing) {
        const previous = document as ProfileDoc;
        document = migrateProfile(previous, profileTemplate(previous, (id, version) => this.getTemplate(id, version)));
        this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)')
          .run(previous.id, this.cipher.encrypt(original), this.now());
      }
      const normalized = JSON.stringify(normalizeRulePresence(row.kind, document));
      if (normalized !== original) this.db.prepare('UPDATE docs SET data = ? WHERE rowid = ?').run(this.cipher.encrypt(normalized), row.rowid);
    }
    for (const row of this.db.prepare('SELECT rowid, data FROM template_versions').all() as { rowid: number; data: string }[]) {
      const normalized = JSON.stringify(normalizeRulePresence('template', JSON.parse(row.data)));
      if (normalized !== row.data) this.db.prepare('UPDATE template_versions SET data = ? WHERE rowid = ?').run(normalized, row.rowid);
    }
  }

  /** v19：先展开旧锁定引用，再移除历史；绑定订阅继续使用当前模板。 */
  private collapseTemplateHistory(): void {
    for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
      const previous = JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc;
      if (previous.routing) continue;
      const next = migrateProfile(previous, profileTemplate(previous, (id, version) => this.getTemplate(id, version)));
      this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)')
        .run(row.id, row.data, this.now());
      this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'profile' AND id = ?")
        .run(this.cipher.encrypt(JSON.stringify(next)), row.id);
    }
    this.db.exec(`DELETE FROM template_versions WHERE (template_id, version) NOT IN (
      SELECT template_id, MAX(version) FROM template_versions GROUP BY template_id)`);
    this.db.exec("UPDATE template_versions SET data = json_remove(data, '$.changelog')");
  }

  /** v20：清除模板和订阅的并发标记，保留归属与更新时间。 */
  private removeConcurrencyMarkers(): void {
    this.db.exec("UPDATE template_versions SET version = 1, data = json_remove(data, '$.version')");
    for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
      const profile = JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc;
      this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'profile' AND id = ?")
        .run(this.cipher.encrypt(JSON.stringify(stripProfileRevisions(profile))), row.id);
    }
  }

  private stripResourceTiming(doc: Record<string, any>): void {
    delete doc.updateIntervalSec;
    if (doc.fetch) { delete doc.fetch.ttlSec; if (!Object.keys(doc.fetch).length) delete doc.fetch; }
    for (const source of doc.sources ?? []) this.stripResourceTiming(source);
  }
  // ---------- 文档 ----------

  /** owner 为 null 表示系统级文档（预设等），只在新建时写入，更新时保持原归属 */
  put<K extends DocKind>(kind: K, doc: DocTypes[K], owner: string | null = null): void {
    this.configurationRevision++;
    doc = structuredClone(doc);
    this.stripResourceTiming(doc as unknown as Record<string, any>);
    if (kind === 'profile') doc = stripProfileRevisions(doc as ProfileDoc) as DocTypes[K];
    if (kind === 'source') doc = normalizeSourceFetch(doc as SourceDoc) as DocTypes[K];
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .run(kind, doc.id, owner, this.cipher.encrypt(JSON.stringify(doc)), this.now());

    })();
    if (kind === 'source' && typeof (doc as SourceDoc).url === 'string') this.dropResourceBindings('source',doc.id,[(doc as SourceDoc).url]);
    if (kind === 'ruleset' && Array.isArray((doc as RuleSetDoc).sources)) this.dropResourceBindings('ruleset',doc.id,(doc as RuleSetDoc).sources.flatMap(s=>s.kind==='remote' && s.url ? [s.url] : []));
    this.pruneResourceBindings();
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
      this.deleteDocumentJobs(kind, id);
      if (kind === 'profile') this.deleteProfileData(id);
      if (kind === 'ruleset') this.db.prepare('DELETE FROM shared_rule_resources WHERE ruleset_id = ?').run(id);
      this.pruneResourceBindings();
      return removed;
    })();
    for (const listener of this.invalidationListeners) listener(kind, id);
    return removed;
  }

  // ---------- 当前模板（沿用旧表结构；版本列仅兼容旧数据迁移，新写入固定为 1） ----------

  putTemplateVersion(t: TemplateVersionDoc): void {
    this.configurationRevision++;
    const { changelog: _changelog, version: _version, ...current } = t;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM template_versions WHERE template_id = ?').run(t.id);
      this.db.prepare('INSERT INTO template_versions (template_id, version, data, created_at) VALUES (?, ?, ?, ?)')
        .run(t.id, 1, JSON.stringify(current), this.now());
    })();
    this.pruneResourceBindings();
    this.changed();
  }

  /** 正常读取当前模板；version 参数仅供旧数据迁移时解析历史引用。 */
  getTemplate(id: string, version?: number): TemplateVersionDoc | undefined {
    const row = (version === undefined
      ? this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1').get(id)
      : this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? AND version = ?').get(id, version)) as { data: string } | undefined;
    const template = row ? JSON.parse(row.data) as TemplateVersionDoc : undefined;
    // 只有尚未迁移的旧记录含有版本号，固定存储键不代表可读取的历史版本。
    return version === undefined || template?.version === version ? template : undefined;
  }

  /** 每个模板的最新版本 */
  listLatestTemplates(): TemplateVersionDoc[] {
    const rows = this.db.prepare(`SELECT t.data FROM template_versions t
      JOIN (SELECT template_id, MAX(version) v FROM template_versions GROUP BY template_id) m ON m.template_id = t.template_id AND m.v = t.version
      ORDER BY t.template_id`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as TemplateVersionDoc);
  }

  listLatestTemplatesPage(options: PageOptions): PageResult<TemplateVersionDoc> {
    return this.readPage(`SELECT t.data FROM template_versions t
      JOIN (SELECT template_id, MAX(version) v FROM template_versions GROUP BY template_id) m ON m.template_id = t.template_id AND m.v = t.version
      ORDER BY t.template_id`, [], options, data => JSON.parse(data) as TemplateVersionDoc);
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

  /** 只删除订阅专属产物；用户凭证与公共规则资源独立存在。 */
  deleteProfileData(profileId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM last_good WHERE profile_id = ?').run(profileId);
      this.db.prepare('DELETE FROM render_generations WHERE profile_id = ?').run(profileId);
      // 访问记录独立保留 30 天；删除资源不抹除用户自己的历史。
      this.db.prepare('DELETE FROM profile_migration_backups WHERE profile_id = ?').run(profileId);
      this.deleteDocumentJobs('profile', profileId);
    })();
  }

  private deleteDocumentJobs(kind: string, id: string): void {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'refresh_jobs'").get()) return;
    for (const row of this.db.prepare('SELECT id,data FROM refresh_jobs').all() as { id: string; data: string }[]) {
      const job = JSON.parse(this.cipher.decrypt(row.data));
      if (job.kind === kind && job.documentId === id) this.db.prepare('DELETE FROM refresh_jobs WHERE id = ?').run(row.id);
    }
  }

  putSharedRule(key: string, rulesetId: string, data: unknown): void {
    this.db.prepare('INSERT INTO shared_rule_resources VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(key, rulesetId, this.cipher.encrypt(JSON.stringify(data)), this.now());
  }
  getSharedRule<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM shared_rule_resources WHERE key = ?').get(key) as { data: string } | undefined;
    return row ? JSON.parse(this.cipher.decrypt(row.data)) as T : undefined;
  }
  listSharedRules<T>(): { key: string; rulesetId: string; data: T; updatedAt: number }[] {
    return (this.db.prepare('SELECT * FROM shared_rule_resources ORDER BY key').all() as { key: string; ruleset_id: string; data: string; updated_at: number }[])
      .map(r => ({ key: r.key, rulesetId: r.ruleset_id, data: JSON.parse(this.cipher.decrypt(r.data)), updatedAt: r.updated_at }));
  }
  deleteSharedRule(key: string): void {
    this.configurationRevision++;
    this.db.prepare('DELETE FROM shared_rule_resources WHERE key = ?').run(key);
    for (const listener of this.invalidationListeners) listener('shared-rule', key);
    this.pruneResourceBindings();
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

  // ---------- 最近一次成功的渲染 ----------

  putLastGood(profileId: string, target: string, data: unknown): void {
    this.db.prepare('INSERT INTO last_good (profile_id, target, rendered_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (profile_id, target) DO UPDATE SET rendered_at = excluded.rendered_at, data = excluded.data')
      .run(profileId, target, this.now(), this.cipher.encrypt(JSON.stringify(data)));
  }

  getLastGood<T>(profileId: string, target: string): { renderedAt: number; data: T } | undefined {
    const row = this.db.prepare('SELECT rendered_at, data FROM last_good WHERE profile_id = ? AND target = ?').get(profileId, target) as { rendered_at: number; data: string } | undefined;
    return row ? { renderedAt: row.rendered_at, data: JSON.parse(this.cipher.decrypt(row.data)) as T } : undefined;
  }

  putRenderGeneration(profileId: string, target: string, version: string, data: unknown): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM render_generations WHERE profile_id = ? AND target = ?').get(profileId, target) as { next: number };
      this.db.prepare('INSERT INTO render_generations (profile_id, target, version, sequence, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (profile_id, target, version) DO UPDATE SET sequence = excluded.sequence, data = excluded.data')
        .run(profileId, target, version, row.next, this.cipher.encrypt(JSON.stringify(data)));
      this.db.prepare(`DELETE FROM render_generations WHERE profile_id = ? AND target = ? AND version NOT IN (
        SELECT version FROM render_generations WHERE profile_id = ? AND target = ? ORDER BY sequence DESC LIMIT ?)`)
        .run(profileId, target, profileId, target, KEEP_RENDER_GENERATIONS);
    })();
  }

  getRenderGeneration<T>(profileId: string, target: string, version: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM render_generations WHERE profile_id = ? AND target = ? AND version = ?').get(profileId, target, version) as { data: string } | undefined;
    return row ? JSON.parse(this.cipher.decrypt(row.data)) as T : undefined;
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

  createUser(u: { username: string; passwordHash: string; role: Role }): User {
    const id = randomId(9);
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(id, u.username, u.passwordHash, u.role, this.now());
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
    const tx = this.db.transaction(() => {
      for (const d of seed.sources ?? []) this.put('source', d, owner);
      for (const d of seed.collections ?? []) this.put('collection', d, owner);
      for (const d of seed.locals ?? []) this.put('local', d, owner);
      for (const d of seed.rulesets ?? []) this.put('ruleset', d, owner);
      // 旧种子里的规则包先按原样写入，下面统一转成规则集
      for (const d of seed.bundles ?? []) {
        this.db.prepare("INSERT OR REPLACE INTO docs (kind, id, owner, data, updated_at) VALUES ('bundle', ?, ?, ?, ?)")
          .run((d as { id: string }).id, owner, this.cipher.encrypt(JSON.stringify(d)), this.now());
      }
      for (const d of seed.presets ?? []) this.put('preset', d);

      for (const t of seed.templates ?? []) {
        // 旧种子可能包含锁定引用，先载入全部模板，订阅迁移后再只留当前内容。
        this.db.prepare('INSERT OR REPLACE INTO template_versions (template_id, version, data, created_at) VALUES (?, ?, ?, ?)')
          .run(t.id, t.version ?? 1, JSON.stringify(t), this.now());
      }
      for (const d of seed.profiles ?? []) {
        const next = migrateProfile(d, profileTemplate(d, (id, v) => this.getTemplate(id, v)));
        if (!d.routing) this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)').run(d.id, this.cipher.encrypt(JSON.stringify(d)), this.now());
        this.put('profile', next, owner);
      }
      // 旧订阅级凭证不升级权限；新种子仅允许给明确用户设置用户级凭证。
      for (const t of seed.tokens ?? []) if ('userId' in t) this.putToken(t);
      // 旧种子里的本地内容订阅源同样转成本地节点组，本地节点上的前置同样转成链规则；旧格式规则集与规则包转成多来源规则集
      this.convertLocalSources();
      this.moveLocalDialers();
      this.convertRuleBundles();
      this.promoteRuleOverrides();
      this.convertSourceUrls();
      this.removeRuleSwitches();
      this.collapseTemplateHistory();
      this.removeConcurrencyMarkers();
    });
    tx();
  }
}
