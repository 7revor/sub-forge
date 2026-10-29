// 索引按仓库原子替换；网络故障不清空旧索引。进程退出前等待任务结束。
import { parseRuleSourceContent, ruleKey, type RuleSetSource } from '@sub-forge/core';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { GitRepoCache, type RepoCache } from './git-cache.ts';
import { randomId } from '../crypto.ts';
import { isIndexedRuleFile, parseCustomRepo, parseScans } from './generic.ts';
import type { Store } from '../store.ts';
import type { UpstreamFetcher } from '../net/upstream.ts';
import { HttpError, bad, notFound } from '../api/common.ts';
import { applyReadme, buildEntries, BUILTIN_REPOS, normalizeSearch, rawUrl, upstreamUrl, type IndexedEntry, type RepoDefinition, type RepoFile } from './adapters.ts';

const DAY = 86_400_000;
type RepoRow = { id: string; enabled: number; built_at: number | null; checked_at: number | null; revisions: string; error: string | null; entries: number; definition: string | null; indexed_definition: string | null };
const configRevision = (value: string) => createHash('sha256').update(value).digest('hex');

export class RuleRepoService {
  private jobs = new Map<string, Promise<void>>();
  private details = new Map<string, Promise<ReturnType<RuleRepoService['formatDetail']>>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private editing = new Set<string>();
  private cache: RepoCache;
  constructor(private store: Store, private fetcher: UpstreamFetcher, private now: () => number = Date.now, cache?: RepoCache) {
    this.cache = cache ?? new GitRepoCache(join(dirname(store.db.name === ':memory:' ? './data/sub-forge.db' : store.db.name), 'rule-repo-cache'));
    this.initializeDefinitions();
    this.upgradeTextIndex();
    this.upgradeLegacySources();
  }
  private initializeDefinitions() {
    this.store.db.transaction(() => {
      if (!this.store.db.prepare("SELECT 1 FROM rule_repo_meta WHERE name = 'initialized'").get()) {
        for (const repo of BUILTIN_REPOS) this.store.db.prepare('INSERT OR IGNORE INTO rule_repos (id, definition) VALUES (?, ?)').run(repo.id, JSON.stringify(repo));
        this.store.db.prepare("INSERT INTO rule_repo_meta (name, value) VALUES ('initialized', '1')").run();
      }
      for (const row of this.rows()) {
        const old = row.definition ? JSON.parse(row.definition) : BUILTIN_REPOS.find(r => r.id === row.id);
        if (!old) throw new Error(`仓库 ${row.id} 缺少配置`);
        let def: RepoDefinition;
        if (old.scans) def = old;
        else if (old.adapter === 'generic') {
          const options = { ...old.options, format: old.options?.format === 'yaml' ? 'auto' : old.options?.format };
          def = { id: old.id, name: old.name, owner: old.owner, repo: old.repo, refs: old.refs, license: old.license,
            scans: old.refs.map((ref: string) => ({ ...options, ref, client: 'any', groupBy: 'path', readme: false, preferred: [] })) };
        } else {
          const seed = BUILTIN_REPOS.find(r => r.id === row.id);
          if (!seed) throw new Error(`仓库 ${row.id} 无法迁移`);
          def = seed;
        }
        const encoded = JSON.stringify(def);
        this.store.db.prepare('UPDATE rule_repos SET definition = ?, indexed_definition = COALESCE(indexed_definition, ?) WHERE id = ?').run(encoded, row.built_at === null ? null : encoded, row.id);
      }
    })();
  }
  /** 只清理索引缓存，不修改已保存来源；上游 commit 不变也会重新建立受影响仓库的索引。 */
  private upgradeTextIndex() {
    this.store.db.transaction(() => {
      const affected = new Set<string>();
      for (const row of this.store.db.prepare('SELECT repo, key, data FROM rule_repo_entries').all() as { repo: string; key: string; data: string }[]) {
        const entry = JSON.parse(row.data) as IndexedEntry;
        const variants = entry.variants.filter(v => v.files.length && v.files.every(f => isIndexedRuleFile(f.path) && !['yaml', 'mrs', 'srs'].includes(f.format)));
        if (variants.length === entry.variants.length) continue;
        affected.add(row.repo);
        if (!variants.length) this.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ? AND key = ?').run(row.repo, row.key);
        else this.store.db.prepare('UPDATE rule_repo_entries SET data = ? WHERE repo = ? AND key = ?').run(JSON.stringify({ ...entry, variants }), row.repo, row.key);
      }
      for (const id of affected) this.store.db.prepare("UPDATE rule_repos SET revisions = '{}', checked_at = NULL WHERE id = ?").run(id);
    })();
  }
  /** 旧导入没有标识：仅匹配旧导入器生成的名称和完整 URL，不将一般自定义地址升级。 */
  private upgradeLegacySources() {
    const files = new Map<string, NonNullable<RuleSetSource['repository']>>();
    for (const row of this.store.db.prepare('SELECT data FROM rule_repo_entries').all() as { data: string }[]) {
      const entry = JSON.parse(row.data) as IndexedEntry;
      const repo = this.definition(entry.repo, true);
      for (const file of entry.variants.flatMap(v => v.files)) {
        files.set(`${entry.repo} · ${file.path}\n${rawUrl(repo, file)}`, { repo: entry.repo, entry: entry.path, ref: file.ref, path: file.path });
      }
    }
    if (!files.size) return;
    for (const doc of this.store.list('ruleset')) {
      let changed = false;
      for (const src of doc.sources) {
        if (src.kind !== 'remote' || src.repository) continue;
        const repository = files.get(`${src.name}\n${src.url}`);
        if (repository) { src.repository = repository; changed = true; }
      }
      if (changed) this.store.put('ruleset', doc, this.store.getWithOwner('ruleset', doc.id)!.owner);
    }
  }
  async linkedSources(repo: string, path: string, variantId?: string) {
    const version = this.snapshotVersion(repo);
    const entry = await this.resolvedEntry(repo, path);
    const variant = this.importVariant(entry, variantId);
    if (!entry.variants.some(v => v.readme)) {
      const detail = await this.detail(repo, path);
      if (detail.previewError) throw new HttpError(400, `规则文件尚不可导入：${detail.previewError}`);
    }
    this.assertEntry(repo, path);
    this.assertSnapshot(repo, version);
    return { name: entry.name, sources: variant.files.map(file => ({
      kind: 'remote' as const, name: `${this.definition(repo, true).name} · ${file.path}`, url: rawUrl(this.definition(repo, true), file),
      format: file.format, behavior: file.behavior,
      repository: { repo, entry: path, ref: file.ref, path: file.path },
    })) };
  }
  /** 首页按物理文件展示；不读取 README，不将多个文件组合为一个变体。 */
  fileList(repo: string, path: string) {
    const entry = this.entry(repo, path);
    const definition = this.definition(repo, true);
    const files = new Map<string, RepoFile>();
    for (const file of entry.variants.flatMap(v => v.files)) {
      if (isIndexedRuleFile(file.path) && !['yaml', 'mrs', 'srs'].includes(file.format)) files.set(JSON.stringify([file.ref, file.path]), file);
    }
    return { repo, path, name: entry.name, license: definition.license, url: `https://github.com/${definition.owner}/${definition.repo}`,
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path) || a.ref.localeCompare(b.ref))
        .map(file => ({ ...file, url: rawUrl(definition, file), upstream: upstreamUrl(definition, file) })) };
  }
  async linkedFileSource(repo: string, path: string, selected: { ref: string; path: string }) {
    const find = () => {
      const entry = this.fileList(repo, path);
      const file = entry.files.find(f => f.ref === selected.ref && f.path === selected.path);
      if (!file) throw bad('所选文件不在当前文本索引中，请刷新后重试');
      return { entry, file };
    };
    const { file } = find();
    const definition = this.definition(repo, true);
    const body = await this.readFile(definition, file);
    const parsed = parseRuleSourceContent(body, { ...file, repository: { repo, entry: path, ref: file.ref, path: file.path } });
    if (parsed.passthrough || !parsed.rules.length) throw bad('所选文件没有可解析的文本规则');
    const current = find();
    if (JSON.stringify(current.file) !== JSON.stringify(file) || JSON.stringify(this.definition(repo, true)) !== JSON.stringify(definition)) throw new HttpError(409, '索引已更新，请重新选择文件');
    return { name: current.entry.name, sources: [{ kind: 'remote' as const,
      name: `${this.definition(repo, true).name} · ${current.file.path}`, url: current.file.url, format: current.file.format, behavior: current.file.behavior,
      repository: { repo, entry: path, ref: current.file.ref, path: current.file.path },
    }] };
  }
  definition(id: string, indexed = false): RepoDefinition {
    const row = this.store.db.prepare('SELECT definition, indexed_definition FROM rule_repos WHERE id = ?').get(id) as RepoRow | undefined;
    const value = indexed ? row?.indexed_definition ?? row?.definition : row?.definition;
    if (!value) throw notFound('规则仓库');
    return JSON.parse(value) as RepoDefinition;
  }
  private rows(): RepoRow[] {
    return this.store.db.prepare('SELECT r.*, (SELECT count(*) FROM rule_repo_entries e WHERE e.repo = r.id) AS entries FROM rule_repos r').all() as RepoRow[];
  }
  list() {
    return this.rows().map(r => {
      const def = this.definition(r.id);
      return { id: r.id, name: def.name, url: `https://github.com/${def.owner}/${def.repo}`, refs: def.refs, scans: def.scans, license: def.license,
        configRevision: configRevision(r.definition!), pending: r.definition !== r.indexed_definition, enabled: !!r.enabled,
        entries: r.entries, builtAt: r.built_at ?? undefined, checkedAt: r.checked_at ?? undefined, error: r.error ?? undefined,
        indexing: this.jobs.has(r.id) || this.editing.has(r.id), revisions: JSON.parse(r.revisions) as Record<string, string> };
    });
  }
  private async parseDefinition(body: Record<string, unknown>, id: string): Promise<RepoDefinition> {
    const input = parseCustomRepo(body);
    const scans = parseScans(body);
    if (this.stopped) throw new HttpError(409, '索引服务已停止');
    const current = this.rows().some(r => r.id === id) ? this.definition(id) : undefined;
    let remote;
    try { remote = await this.cache.inspect({ id, owner: input.owner, repo: input.repo }); }
    catch (error) { throw new HttpError(502, `无法通过 Git 读取公开仓库：${error instanceof Error ? error.message : String(error)}`); }
    if (!remote.branches.length) throw bad('仓库没有可用分支，请先向上游提交内容');
    for (const scan of scans) {
      if (!scan.ref) {
        if (!remote.defaultBranch) throw bad('无法识别仓库默认分支，请手动填写分支');
        scan.ref = parseCustomRepo({ url: body.url, ref: remote.defaultBranch }).ref!;
      }
      if (!remote.branches.includes(scan.ref)) throw bad(`仓库分支不存在：${scan.ref}`);
    }
    // Git 不提供托管平台的许可证分类；保留同仓库已有说明或使用上游提示。
    const sameRepo = current?.owner.toLowerCase() === input.owner.toLowerCase() && current.repo.toLowerCase() === input.repo.toLowerCase();
    let license = sameRepo ? current.license : '见上游仓库许可证';
    if (body.license !== undefined) {
      if (typeof body.license !== 'string' || body.license.length > 200 || /[\x00-\x1f]/.test(body.license)) throw bad('许可证需为不超过 200 字的文本');
      license = body.license;
    }
    return { id, name: input.name, owner: input.owner, repo: input.repo, refs: [...new Set(scans.map(s => s.ref))], license, scans };
  }
  private assertUnique(def: RepoDefinition) {
    if (this.rows().some(row => {
      const other = this.definition(row.id);
      return other.id !== def.id && other.owner.toLowerCase() === def.owner.toLowerCase() && other.repo.toLowerCase() === def.repo.toLowerCase() && other.refs.some(ref => def.refs.includes(ref));
    })) throw new HttpError(409, '该仓库的此分支已添加');
  }
  async addCustom(body: Record<string, unknown>) {
    const def = await this.parseDefinition(body, `custom-${randomId(9)}`);
    if (this.stopped) throw new HttpError(409, '索引服务已停止');
    this.assertUnique(def);
    this.store.db.prepare('INSERT INTO rule_repos (id, definition) VALUES (?, ?)').run(def.id, JSON.stringify(def));
    return def.id;
  }
  async update(id: string, body: Record<string, unknown>) {
    this.definition(id);
    if (this.jobs.has(id) || this.editing.has(id)) throw new HttpError(409, '索引正在更新，请完成后再编辑');
    if (body.configRevision !== configRevision(JSON.stringify(this.definition(id)))) throw new HttpError(409, '仓库配置已变更，请重新打开编辑');
    this.editing.add(id);
    try {
      const def = await this.parseDefinition(body, id);
      if (this.stopped) throw new HttpError(409, '索引服务已停止');
      this.assertUnique(def);
      this.store.db.prepare('UPDATE rule_repos SET definition = ?, checked_at = NULL, error = NULL WHERE id = ?').run(JSON.stringify(def), id);
    } finally { this.editing.delete(id); }
  }
  async removeCustom(id: string) {
    this.definition(id);
    if (this.jobs.has(id) || this.editing.has(id)) throw new HttpError(409, '索引正在更新，请完成后再删除');
    this.editing.add(id);
    try {
      await this.cache.remove(id);
      this.store.db.transaction(() => {
        this.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run(id);
        this.store.db.prepare('DELETE FROM rule_repos WHERE id = ?').run(id);
      })();
      this.details.clear();
    } finally { this.editing.delete(id); }
  }
  /** 导入前重新确认仓库仍启用、文件仍在索引中。 */
  assertEntry(id: string, path: string) { this.entry(id, path); }
  setEnabled(id: string, enabled: boolean) {
    this.definition(id);
    if (this.editing.has(id)) throw new HttpError(409, '仓库配置正在更新');
    this.store.db.prepare('UPDATE rule_repos SET enabled = ? WHERE id = ?').run(Number(enabled), id);
  }
  private snapshotVersion(id: string) {
    return JSON.stringify(this.store.db.prepare('SELECT indexed_definition, revisions, built_at FROM rule_repos WHERE id = ?').get(id));
  }
  private assertSnapshot(id: string, version: string) {
    this.assertEnabled(id);
    if (this.snapshotVersion(id) !== version) throw new HttpError(409, '索引已更新，请重试');
  }
  private assertEnabled(id: string) {
    if (this.editing.has(id)) throw new HttpError(409, '仓库配置正在更新');
    const repo = this.definition(id);
    if (!this.rows().find(r => r.id === id)?.enabled) throw notFound('已启用的规则仓库');
    return repo;
  }
  search(q: string, repo: string | undefined, client: string | undefined, offset: number, limit: number) {
    if (repo) this.assertEnabled(repo);
    const query = normalizeSearch(q);
    const rows = this.store.db.prepare(`SELECT e.data FROM rule_repo_entries e JOIN rule_repos r ON r.id = e.repo
      WHERE r.enabled = 1 AND (? IS NULL OR e.repo = ?) AND instr(e.search_name, ?) > 0
      ORDER BY CASE WHEN e.search_name = ? THEN 0 WHEN instr(e.search_name, ?) = 1 THEN 1 ELSE 2 END, e.search_name, e.repo, e.key`)
      .all(repo ?? null, repo ?? null, query, query, query) as { data: string }[];
    const entries = rows.map(r => JSON.parse(r.data) as IndexedEntry).filter(e => !client || e.variants.some(v => (v.client === client || v.client === 'any')));
    return { items: entries.slice(offset, offset + limit).map(({ variants, ...e }) => ({ ...e, clients: [...new Set(variants.map(v => v.client))] })), total: entries.length, offset, limit };
  }
  private entry(repo: string, path: string): IndexedEntry {
    this.assertEnabled(repo);
    const row = this.store.db.prepare('SELECT data FROM rule_repo_entries WHERE repo = ? AND key = ?').get(repo, path) as { data: string } | undefined;
    if (!row) throw notFound('仓库规则');
    return JSON.parse(row.data) as IndexedEntry;
  }
  private async readFile(repo: RepoDefinition, file: RepoFile): Promise<string> {
    this.assertEnabled(repo.id);
    if (file.commit) return this.cache.read(repo, file.commit, file.path);
    // 迁移前的旧索引仍可使用；首次 Git 同步后每个文件均携带固定提交。
    const response = await this.fetcher(rawUrl(repo, file), { timeoutMs: 20_000 });
    if (response.status !== 200) throw new Error(`规则文件读取失败：HTTP ${response.status}`);
    return response.body;
  }
  refresh(id: string): Promise<void> {
    this.assertEnabled(id);
    if (this.editing.has(id)) throw new HttpError(409, '仓库配置正在更新');
    if (this.stopped) throw new HttpError(409, '索引服务已停止');
    const running = this.jobs.get(id);
    if (running) return running;
    const job = this.build(id).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    return job;
  }
  private async build(id: string) {
    const repo = this.definition(id);
    try {
      const previous = this.rows().find(r => r.id === id)!;
      const revisions = await this.cache.sync(repo);
      if (this.stopped) throw new Error('索引服务正在关闭');
      if (previous.built_at === null || JSON.stringify(revisions) !== previous.revisions || previous.indexed_definition !== JSON.stringify(repo)
          || (this.store.db.prepare('SELECT data FROM rule_repo_entries WHERE repo = ? LIMIT 1').get(id) as { data: string } | undefined)?.data.includes('"commit"') === false) {
        const trees: Record<string, string[]> = {};
        for (const ref of repo.refs) trees[ref] = await this.cache.files(repo, revisions[ref]!);
        const entries = buildEntries(repo, trees, revisions);
        if (this.stopped) throw new Error('索引服务正在关闭');
        this.store.db.transaction(() => {
          this.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run(id);
          const insert = this.store.db.prepare('INSERT INTO rule_repo_entries (repo, key, search_name, data) VALUES (?, ?, ?, ?)');
          for (const entry of entries) insert.run(id, entry.path, normalizeSearch(entry.name), JSON.stringify(entry));
          this.store.db.prepare('UPDATE rule_repos SET built_at = ?, revisions = ?, indexed_definition = ? WHERE id = ?').run(this.now(), JSON.stringify(revisions), JSON.stringify(repo), id);
        })();
        this.details.clear();
        this.upgradeLegacySources();
      }
      this.store.db.prepare('UPDATE rule_repos SET checked_at = ?, error = NULL WHERE id = ?').run(this.now(), id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.db.prepare('UPDATE rule_repos SET checked_at = ?, error = ? WHERE id = ?').run(this.now(), `索引更新失败：${message}`, id);
      console.warn(`规则仓库 ${id} 索引更新失败：${message}`);
    }
  }
  start() {
    if (this.timer || this.stopped) return;
    const tick = () => {
      for (const row of this.rows()) {
        if (!this.editing.has(row.id) && row.enabled && (row.checked_at === null || this.now() - row.checked_at >= (row.error ? 15 * 60_000 : DAY))) void this.refresh(row.id);
      }
    };
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.cache.stop();
    await Promise.all(this.jobs.values());
    await Promise.allSettled(this.details.values());
  }
  private formatDetail(entry: IndexedEntry, preview: string[], count: number | undefined, previewError?: string, rejectedDetails: { line: number; text: string; reason: string }[] = [], rejected = 0) {
    const repo = this.definition(entry.repo, true);
    return { ...entry, count, license: repo.license, url: `https://github.com/${repo.owner}/${repo.repo}`, preview, previewError, rejected, rejectedDetails,
      variants: entry.variants.map(v => ({ ...v, file: v.files.map(f => f.path).join(' + '), how: '文本托管',
        files: v.files.map(f => ({ ...f, url: rawUrl(repo, f), upstream: upstreamUrl(repo, f) })) })) };
  }
  async resolvedEntry(id: string, path: string): Promise<IndexedEntry> {
    const version = this.snapshotVersion(id);
    const entry = this.entry(id, path);
    const repo = this.definition(id, true);
    const readmes = new Set<string>();
    for (const variant of [...entry.variants]) {
      const file = variant.files[0];
      if (!variant.readme || !file) continue;
      const directory = file.path.slice(0, file.path.lastIndexOf('/') + 1);
      const key = JSON.stringify([variant.client, file.ref, directory]);
      if (readmes.has(key)) continue;
      readmes.add(key);
      const readme = { ...file, path: directory + 'README.md' };
      applyReadme(entry, variant.client, await this.readFile(repo, readme), { ref: file.ref, directory });
    }
    this.assertSnapshot(id, version);
    return entry;
  }
  detail(id: string, path: string) {
    this.entry(id, path);
    const version = this.snapshotVersion(id);
    const key = `${id}:${path}:${version}`;
    const cached = this.details.get(key);
    if (cached) return cached;
    const job = (async () => {
      const entry = await this.resolvedEntry(id, path);
      const variant = this.importVariant(entry);
      const repo = this.definition(id, true);
      const preview: string[] = [];
      const keys = new Set<string>();
      const rejectedDetails: { line: number; text: string; reason: string }[] = [];
      let rejected = 0;
      try {
        for (const file of variant.files) {
          const body = await this.readFile(repo, file);
          const parsed = parseRuleSourceContent(body, { ...file, repository: { repo: id, entry: path, ref: file.ref, path: file.path } });
          if (parsed.passthrough || !parsed.rules.length) throw new Error('文件中没有可解析的规则');
          rejected += parsed.rejected.length;
          rejectedDetails.push(...parsed.rejected.slice(0, Math.max(0, 50 - rejectedDetails.length)).map(r => ({ ...r, text: r.text.slice(0, 500) })));
          for (const rule of parsed.rules) keys.add(ruleKey(rule.rule));
          preview.push(`# 来源：${rawUrl(repo, file)}`, ...body.split(/\r?\n/).slice(0, 80));
        }
        this.assertSnapshot(id, version);
        return this.formatDetail(entry, preview.slice(0, 160), keys.size, undefined, rejectedDetails, rejected);
      } catch (error) {
        return this.formatDetail(entry, [], undefined, `内容预览失败：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    if (this.details.size >= 50) this.details.delete(this.details.keys().next().value!);
    this.details.set(key, job);
    // 失败后可重新尝试；成功结果只在当前索引版本内缓存。
    void job.then(result => { if (result.previewError) this.details.delete(key); }, () => this.details.delete(key));
    return job;
  }
  importVariant(entry: IndexedEntry, variantId?: string) {
    const text = entry.variants.filter(v => v.files.length && v.files.every(f => isIndexedRuleFile(f.path) && !['yaml', 'mrs', 'srs'].includes(f.format)));
    const variant = variantId ? text.find(v => v.id === variantId) : text.find(v => v.client === 'mihomo' && v.recommended) ?? text.find(v => v.recommended) ?? text[0];
    if (!variant) throw bad('请选择 .list 或 .txt 文本变体');
    return variant;
  }
}
