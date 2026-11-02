// 跨版本升级与旧种子转换。全部步骤在 Store 打开或导入的单个事务内执行，失败整体回滚。
// 历史模板只从 template_versions 读取；当前读取路径见 Store.getTemplate。

import { exactNameRegex, NodeSetResolver, type ChainRule, type LocalProxy, type Profile, type Target } from '@sub-forge/core';
import type Database from 'better-sqlite3';
import { randomId, type Cipher } from './crypto.ts';
import type { LocalDoc, ProfileDoc, RuleSetDoc, Seed, SourceDoc, TemplateVersionDoc } from './docs.ts';
import { convertBundles, normalizeRuleSet, promoteRuleSetOverrides, retargetBundleRefs } from './legacy-rules.ts';
import { migrateNativeDocument, retireProfilePreset } from './native-migration.ts';
import { migrateProfile, profileTemplate, stripProfileRevisions } from './profile-routing.ts';
import { normalizeRulePresence } from './rule-presence.ts';
import { SCHEMA, SCHEMA_VERSION } from './schema.ts';
import { normalizeSourceFetch, sourceUrl, stripResourceTiming } from './source-url.ts';
import type { Store, TemplateReader } from './store.ts';

const LEGACY_TEMPLATE_SCHEMA = `CREATE TABLE IF NOT EXISTS template_versions (
  template_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, version)
);`;

class StoreMigration {
  private readonly db: Database.Database;
  private readonly cipher: Cipher;

  constructor(private readonly store: Store, private readonly now: () => number) {
    this.db = store.db;
    this.cipher = store.cipher;
  }

  /** 只在升级和旧种子事务内使用：此时 template_versions 尚未销毁，锁定引用仍可按原版本展开。 */
  private readonly legacyTemplates: TemplateReader = {
    get: (id, version) => {
      const row = (version === undefined
        ? this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? ORDER BY version DESC LIMIT 1').get(id)
        : this.db.prepare('SELECT data FROM template_versions WHERE template_id = ? AND version = ?').get(id, version)) as { data: string } | undefined;
      const template = row ? JSON.parse(row.data) as TemplateVersionDoc : undefined;
      return version === undefined || template?.version === version ? template : undefined;
    },
    list: () => (this.db.prepare(`SELECT t.data FROM template_versions t
      JOIN (SELECT template_id, MAX(version) v FROM template_versions GROUP BY template_id) m ON m.template_id = t.template_id AND m.v = t.version
      ORDER BY t.template_id`).all() as { data: string }[]).map(row => JSON.parse(row.data)),
  };

  /** 旧版数据库升级到当前结构（v1：docs 无 owner、token 明文；v4 及以前：订阅源可以是本地内容；v5 及以前：本地节点可以设置前置；v6 及以前：规则集单一来源、另有规则包；v7：客户端改写绑定来源；v8 及以前：订阅地址可能保存在 urls 数组） */
  upgrade(): void {
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
      this.db.exec(LEGACY_TEMPLATE_SCHEMA);
      this.db.exec('INSERT OR IGNORE INTO template_versions SELECT id, 1, data, updated_at FROM templates');
      // 已退役表仅在旧凭据迁移期间使用，不能由当前建表脚本重建。
      if (version < 23) this.db.exec(`CREATE TABLE IF NOT EXISTS sub_tokens (
  token_hash TEXT PRIMARY KEY, token_enc TEXT NOT NULL, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sub_tokens_profile ON sub_tokens (profile_id);
`);
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
          const migrated = migrateProfile(previous, profileTemplate(previous, this.legacyTemplates.get));
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
          stripResourceTiming(doc);
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
        for (const user of this.store.listUsers()) this.store.createToken(user.id);
        this.db.exec('DROP TABLE sub_tokens; DELETE FROM last_good;');
        this.store.pruneResourceBindings(this.legacyTemplates);
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
        // 旧配置中的路径 token 地址全部失效，不能用 last-good 再下发旧入口。
        this.db.exec('DELETE FROM last_good');
        for (const row of this.store.listSharedRules<{ reference: { matcher: { remote?: unknown } } }>()) {
          if (row.data.reference.matcher.remote) this.db.prepare('DELETE FROM shared_rule_resources WHERE key = ?').run(row.key);
        }
        this.store.pruneResourceBindings(this.legacyTemplates);
      }
      if (version < 26) {
        const columns = new Set((this.db.prepare('PRAGMA table_info(access_log)').all() as { name: string }[]).map(column => column.name));
        for (const [name, definition] of Object.entries({ client_ip: 'TEXT', peer_ip: 'TEXT', ip_source: "TEXT NOT NULL DEFAULT 'unknown'" })) {
          if (!columns.has(name)) this.db.exec(`ALTER TABLE access_log ADD COLUMN ${name} ${definition}`);
        }
      }
      if (version < 27) {
        // 移除结构版本历史，同时清空仍携带 version 下载地址的旧渲染结果。
        this.db.exec('DROP TABLE IF EXISTS render_generations; DELETE FROM last_good');
      }
      if (version < 28) {
        this.migrateNativeConfigs();
        // 清理旧基础转换产物；节点和规则按当前订阅重新生成。种子导入复用上面的转换，但不能丢失现有兜底配置。
        this.db.exec('DELETE FROM last_good');
      }
      if (version < 30) {
        this.normalizeProfileRouting();
        for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'source'").all() as { id: string; data: string }[]) {
          const previous = JSON.parse(this.cipher.decrypt(row.data)) as SourceDoc;
          const next = normalizeSourceFetch(previous);
          if (JSON.stringify(next) !== JSON.stringify(previous)) this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'source' AND id = ?").run(this.cipher.encrypt(JSON.stringify(next)), row.id);
        }
        this.db.exec('DROP TABLE IF EXISTS sub_tokens');
      }
      this.finishTemplateMigration();
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
    for (const rs of this.store.list('ruleset')) {
      const next = promoteRuleSetOverrides(rs, (src) => src.url ? this.store.latestSnapshot('ruleset', rs.id, src.url)?.body : undefined);
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

  /** 在原事务内移除停用项，保留归属、更新时间、版本、令牌与历史渲染资源。 */
  private removeRuleSwitches(): void {
    for (const row of this.db.prepare("SELECT rowid, kind, data FROM docs WHERE kind IN ('ruleset', 'profile')").all() as { rowid: number; kind: string; data: string }[]) {
      const original = this.cipher.decrypt(row.data);
      let document = JSON.parse(original);
      if (row.kind === 'profile' && !document.routing) {
        const previous = document as ProfileDoc;
        document = migrateProfile(previous, profileTemplate(previous, this.legacyTemplates.get));
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

  /** v29/v30：补齐旧订阅并移除退役字段，历史备份与外部身份保持不变。 */
  private normalizeProfileRouting(): void {
    for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
      const original = this.cipher.decrypt(row.data);
      const previous = JSON.parse(original) as ProfileDoc;
      const next = migrateProfile(previous, profileTemplate(previous, this.legacyTemplates.get));
      const normalized = JSON.stringify(next);
      if (normalized === original) continue;
      this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)')
        .run(previous.id, row.data, this.now());
      this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'profile' AND id = ?").run(this.cipher.encrypt(normalized), row.id);
    }
  }

  /** v19：先展开旧锁定引用，再移除历史；绑定订阅继续使用当前模板。 */
  private collapseTemplateHistory(): void {
    for (const row of this.db.prepare("SELECT id, data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
      const previous = JSON.parse(this.cipher.decrypt(row.data)) as ProfileDoc;
      if (previous.routing) continue;
      const next = migrateProfile(previous, profileTemplate(previous, this.legacyTemplates.get));
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

  /** 整体备份后升级；失败由外层事务回滚，原配置和归属不变。 */
  private migrateNativeConfigs(): void {
    const rows = this.db.prepare('SELECT kind,id,data FROM docs').all() as { kind: string; id: string; data: string }[];
    const presets = new Map(rows.filter(r => r.kind === 'preset').map(r => [r.id, JSON.parse(this.cipher.decrypt(r.data))]));
    for (const row of rows) {
      const previous = JSON.parse(this.cipher.decrypt(row.data));
      const next = migrateNativeDocument(row.kind, previous, presets.get(previous.base?.presetId));
      if (JSON.stringify(next) === JSON.stringify(previous)) continue;
      this.db.prepare('INSERT OR IGNORE INTO native_migration_backups VALUES (?,?,?,?)').run(row.kind, row.id, row.data, this.now());
      this.db.prepare('UPDATE docs SET data = ? WHERE kind = ? AND id = ?').run(this.cipher.encrypt(JSON.stringify(next)), row.kind, row.id);
    }
    for (const row of this.db.prepare('SELECT template_id,version,data FROM template_versions').all() as {template_id:string;version:number;data:string}[]) {
      const previous = JSON.parse(row.data), next = migrateNativeDocument('template', previous);
      if (JSON.stringify(next) === JSON.stringify(previous)) continue;
      this.db.prepare('INSERT OR IGNORE INTO native_migration_backups VALUES (?,?,?,?)').run('template', row.template_id + ':' + row.version, this.cipher.encrypt(row.data), this.now());
      this.db.prepare('UPDATE template_versions SET data = ? WHERE template_id = ? AND version = ?').run(JSON.stringify(next), row.template_id, row.version);
    }
    const nativePresets = new Map(this.store.list('preset').map(preset => [preset.id, preset]));
    for (const row of this.db.prepare("SELECT id,data FROM docs WHERE kind = 'profile'").all() as { id: string; data: string }[]) {
      const previous = JSON.parse(this.cipher.decrypt(row.data));
      const next = retireProfilePreset(previous, nativePresets.get(previous.base?.presetId));
      if (next === previous) continue;
      this.db.prepare('INSERT OR IGNORE INTO native_migration_backups VALUES (?,?,?,?)').run('profile', row.id, row.data, this.now());
      this.db.prepare("UPDATE docs SET data = ? WHERE kind = 'profile' AND id = ?").run(this.cipher.encrypt(JSON.stringify(next)), row.id);
    }
    // 包括未引用的预设也先留存加密原件，再移除已退役的活动文档。
    for (const row of this.db.prepare("SELECT id,data FROM docs WHERE kind = 'preset'").all() as { id: string; data: string }[]) {
      this.db.prepare('INSERT OR IGNORE INTO native_migration_backups VALUES (?,?,?,?)').run('preset', row.id, row.data, this.now());
    }
    this.db.exec("DELETE FROM docs WHERE kind = 'preset'");
  }

  /** 历史版本已由订阅迁移器展开，活动表只留下当前模板；同一事务内完成。 */
  private finishTemplateMigration(): void {
    this.db.exec(`INSERT OR REPLACE INTO templates (id, data, updated_at)
      SELECT template_id, json_remove(data, '$.version', '$.changelog'), created_at FROM template_versions;
      DROP TABLE template_versions`);
  }

  /** owner：有归属的文档写入到该用户名下（缺省为无归属） */
  importSeed(seed: Seed, owner: string | null): void {
    const tx = this.db.transaction(() => {
      this.db.exec(LEGACY_TEMPLATE_SCHEMA.replace('CREATE TABLE', 'CREATE TEMP TABLE'));
      this.db.exec('INSERT INTO template_versions SELECT id, 1, data, updated_at FROM templates');
      for (const d of seed.sources ?? []) this.store.put('source', d, owner, this.legacyTemplates);
      for (const d of seed.collections ?? []) this.store.put('collection', d, owner, this.legacyTemplates);
      for (const d of seed.locals ?? []) this.store.put('local', d, owner, this.legacyTemplates);
      for (const d of seed.rulesets ?? []) this.store.put('ruleset', d, owner, this.legacyTemplates);
      // 旧种子里的规则包先按原样写入，下面统一转成规则集
      for (const d of seed.bundles ?? []) {
        this.db.prepare("INSERT OR REPLACE INTO docs (kind, id, owner, data, updated_at) VALUES ('bundle', ?, ?, ?, ?)")
          .run((d as { id: string }).id, owner, this.cipher.encrypt(JSON.stringify(d)), this.now());
      }
      for (const d of seed.presets ?? []) this.store.put('preset', d, null, this.legacyTemplates);

      for (const t of seed.templates ?? []) {
        // 旧种子可能包含锁定引用，先载入全部模板，订阅迁移后再只留当前内容。
        this.db.prepare('INSERT OR REPLACE INTO template_versions (template_id, version, data, created_at) VALUES (?, ?, ?, ?)')
          .run(t.id, t.version ?? 1, JSON.stringify(t), this.now());
      }
      for (const d of seed.profiles ?? []) {
        // 预设展开的备份必须保留原始输入，不能先被 routing 规范化丢掉历史字段。
        if (d.base?.presetId) this.db.prepare('INSERT OR IGNORE INTO native_migration_backups VALUES (?,?,?,?)').run('profile', d.id, this.cipher.encrypt(JSON.stringify(d)), this.now());
        const next = migrateProfile(d, profileTemplate(d, this.legacyTemplates.get));
        if (!d.routing) this.db.prepare('INSERT OR IGNORE INTO profile_migration_backups (profile_id, data, created_at) VALUES (?, ?, ?)').run(d.id, this.cipher.encrypt(JSON.stringify(d)), this.now());
        this.store.put('profile', next, owner, this.legacyTemplates);
      }
      // 旧订阅级凭证不升级权限；新种子仅允许给明确用户设置用户级凭证。
      for (const t of seed.tokens ?? []) if ('userId' in t) this.store.putToken(t);
      // 旧种子里的本地内容订阅源同样转成本地节点组，本地节点上的前置同样转成链规则；旧格式规则集与规则包转成多来源规则集
      this.convertLocalSources();
      this.moveLocalDialers();
      this.convertRuleBundles();
      this.promoteRuleOverrides();
      this.convertSourceUrls();
      this.removeRuleSwitches();
      this.collapseTemplateHistory();
      this.removeConcurrencyMarkers();
      this.migrateNativeConfigs();
      this.finishTemplateMigration();
    });
    tx();
  }
}

export function migrateDatabase(store: Store, now: () => number): void {
  new StoreMigration(store, now).upgrade();
}

export function importSeedDocuments(store: Store, seed: Seed, owner: string | null, now: () => number): void {
  new StoreMigration(store, now).importSeed(seed, owner);
}
