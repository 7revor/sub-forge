// 索引按仓库原子替换；网络故障不清空旧索引。进程退出前等待任务结束。
import { parseRuleSetContent, ruleKey, type RuleSetSource } from '@sub-forge/core';
import { randomId } from '../crypto.ts';
import { isIndexedRuleFile, parseCustomRepo } from './generic.ts';
import type { Store } from '../store.ts';
import type { UpstreamFetcher } from '../net/upstream.ts';
import { HttpError, bad, notFound } from '../api/common.ts';
import { applyReadme, buildEntries, BUILTIN_REPOS, normalizeSearch, rawUrl, upstreamUrl, type IndexedEntry, type RepoDefinition, type RepoFile } from './adapters.ts';

const DAY = 86_400_000;
type RepoRow = { id: string; enabled: number; built_at: number | null; checked_at: number | null; revisions: string; error: string | null; entries: number; definition: string | null };
type Tree = { sha: string; truncated: boolean; tree: { path: string; type: string; sha: string; mode?: string }[] };

export class RuleRepoService {
  private jobs = new Map<string, Promise<void>>();
  private details = new Map<string, Promise<ReturnType<RuleRepoService['formatDetail']>>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(private store: Store, private fetcher: UpstreamFetcher, private now: () => number = Date.now) {
    const insert = store.db.prepare('INSERT OR IGNORE INTO rule_repos (id) VALUES (?)');
    for (const repo of BUILTIN_REPOS) insert.run(repo.id);
    this.upgradeTextIndex();
    this.upgradeLegacySources();
  }
  /** 只清理索引缓存，不修改已保存来源；上游 commit 不变也会重新建立受影响仓库的索引。 */
  private upgradeTextIndex() {
    this.store.db.transaction(() => {
      const affected = new Set<string>();
      for (const row of this.rows()) {
        if (!row.definition) continue;
        const def = JSON.parse(row.definition) as RepoDefinition;
        if (def.options?.format === 'yaml') {
          def.options.format = 'auto';
          this.store.db.prepare('UPDATE rule_repos SET definition = ? WHERE id = ?').run(JSON.stringify(def), row.id);
          affected.add(row.id);
        }
      }
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
      const repo = this.definition(entry.repo);
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
    const entry = await this.resolvedEntry(repo, path);
    const variant = this.importVariant(entry, variantId);
    if (this.definition(repo).adapter === 'generic') {
      const detail = await this.detail(repo, path);
      if (detail.previewError) throw new HttpError(400, `规则文件尚不可导入：${detail.previewError}`);
    }
    this.assertEntry(repo, path);
    return { name: entry.name, sources: variant.files.map(file => ({
      kind: 'remote' as const, name: `${this.definition(repo).name} · ${file.path}`, url: rawUrl(this.definition(repo), file),
      format: file.format, behavior: file.behavior,
      repository: { repo, entry: path, ref: file.ref, path: file.path },
    })) };
  }
  definition(id: string): RepoDefinition {
    const row = this.store.db.prepare('SELECT definition FROM rule_repos WHERE id = ?').get(id) as { definition: string | null } | undefined;
    const repo = row?.definition ? JSON.parse(row.definition) as RepoDefinition : BUILTIN_REPOS.find(r => r.id === id);
    if (!repo) throw notFound('规则仓库');
    return repo;
  }
  private rows(): RepoRow[] {
    return this.store.db.prepare('SELECT r.*, (SELECT count(*) FROM rule_repo_entries e WHERE e.repo = r.id) AS entries FROM rule_repos r').all() as RepoRow[];
  }
  list() {
    return this.rows().map(r => {
      const def = this.definition(r.id);
      return { id: r.id, name: def.name, url: `https://github.com/${def.owner}/${def.repo}`, builtIn: def.adapter !== 'generic', ...(def.adapter === 'generic' ? { ref: def.refs[0], ...def.options } : {}), enabled: !!r.enabled,
        entries: r.entries, builtAt: r.built_at ?? undefined, checkedAt: r.checked_at ?? undefined, error: r.error ?? undefined,
        indexing: this.jobs.has(r.id), revisions: JSON.parse(r.revisions) as Record<string, string> };
    });
  }
  async addCustom(body: Record<string, unknown>) {
    const input = parseCustomRepo(body);
    if (this.stopped) throw new HttpError(409, '索引服务已停止');
    let metadata: { private: boolean; default_branch: string; license?: { spdx_id?: string } | null };
    try { metadata = await this.json(`https://api.github.com/repos/${input.owner}/${input.repo}`); }
    catch (error) { throw new HttpError(502, `无法读取公开 GitHub 仓库：${error instanceof Error ? error.message : String(error)}`); }
    if (metadata.private !== false || typeof metadata.default_branch !== 'string' || !metadata.default_branch) throw bad('仅支持公开 GitHub 仓库，或上游仓库信息无效');
    if (this.stopped) throw new HttpError(409, '索引服务已停止');
    const ref = input.ref ?? metadata.default_branch;
    const { name, owner, repo, directory, include, exclude, format } = input;
    const def: RepoDefinition = { id: `custom-${randomId(9)}`, name, owner, repo, refs: [ref], adapter: 'generic',
      license: metadata.license?.spdx_id && metadata.license.spdx_id !== 'NOASSERTION' ? metadata.license.spdx_id : '见上游仓库许可证',
      options: { directory, include, exclude, format } };
    this.store.db.transaction(() => {
      const duplicate = this.rows().some(row => {
        const r = this.definition(row.id);
        return r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase() && r.refs.includes(ref);
      });
      if (duplicate) throw new HttpError(409, '该仓库的此分支已添加');
      this.store.db.prepare('INSERT INTO rule_repos (id, definition) VALUES (?, ?)').run(def.id, JSON.stringify(def));
    })();
    return def.id;
  }
  removeCustom(id: string) {
    if (this.definition(id).adapter !== 'generic') throw bad('内置仓库只能停用，不能删除');
    if (this.jobs.has(id)) throw new HttpError(409, '索引正在更新，请完成后再删除');
    this.store.db.transaction(() => {
      this.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run(id);
      this.store.db.prepare('DELETE FROM rule_repos WHERE id = ?').run(id);
    })();
    this.details.clear();
  }
  /** 导入前重新确认仓库仍启用、文件仍在索引中。 */
  assertEntry(id: string, path: string) { this.entry(id, path); }
  setEnabled(id: string, enabled: boolean) {
    this.definition(id);
    this.store.db.prepare('UPDATE rule_repos SET enabled = ? WHERE id = ?').run(Number(enabled), id);
  }
  private assertEnabled(id: string) {
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
  private async json<T>(url: string): Promise<T> {
    const response = await this.fetcher(url, { ua: 'Sub-Forge-rule-index', timeoutMs: 20_000 });
    if (response.status !== 200) throw new Error(`GitHub 返回 HTTP ${response.status}`);
    return JSON.parse(response.body) as T;
  }
  private async files(repo: RepoDefinition, treeSha: string): Promise<string[]> {
    const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/`;
    let requests = 0;
    const read = async (sha: string, recursive: boolean) => {
      if (++requests > 100 || this.stopped) throw new Error('索引已停止或文件树超过遍历上限');
      const tree = await this.json<Tree>(`${base}${encodeURIComponent(sha)}${recursive ? '?recursive=1' : ''}`);
      if (!Array.isArray(tree.tree) || typeof tree.truncated !== 'boolean') throw new Error('GitHub 文件树响应无效');
      return tree;
    };
    const wanted = (path: string) => repo.adapter !== 'blackmatrix7' || ['rule/Clash', 'rule/Surge'].some(prefix => prefix.startsWith(path + '/') || path === prefix || path.startsWith(prefix + '/'));
    const walk = async (sha: string, prefix: string): Promise<string[]> => {
      const tree = await read(sha, true);
      if (!tree.truncated) return tree.tree.filter(f => f.type === 'blob' && f.mode !== '120000').map(f => prefix + f.path).filter(wanted);
      // GitHub 递归结果被截断时改用完整的非递归树，再逐目录展开。
      const shallow = await read(sha, false);
      if (shallow.truncated) throw new Error('GitHub 非递归文件树被截断，保留旧索引');
      const paths: string[] = [];
      for (const node of shallow.tree) {
        const path = prefix + node.path;
        if (!wanted(path)) continue;
        if (node.type === 'tree') paths.push(...await walk(node.sha, path + '/'));
        else if (node.type === 'blob' && node.mode !== '120000') paths.push(path);
      }
      return paths;
    };
    return walk(treeSha, '');
  }
  refresh(id: string): Promise<void> {
    this.assertEnabled(id);
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
      const revisions: Record<string, string> = {};
      const treeShas: Record<string, string> = {};
      for (const ref of repo.refs) {
        if (this.stopped) throw new Error('索引服务正在关闭');
        const commit = await this.json<{ sha: string; commit: { tree: { sha: string } } }>(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref)}`);
        if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new Error('GitHub commit 响应无效');
        revisions[ref] = commit.sha;
        treeShas[ref] = commit.commit.tree.sha;
      }
      if (previous.built_at === null || JSON.stringify(revisions) !== previous.revisions) {
        const trees: Record<string, string[]> = {};
        for (const ref of repo.refs) trees[ref] = await this.files(repo, treeShas[ref]!);
        const entries = buildEntries(repo, trees);
        if (!entries.length && repo.adapter !== 'generic') throw new Error('上游没有可识别的规则文件，保留旧索引');
        this.store.db.transaction(() => {
          this.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run(id);
          const insert = this.store.db.prepare('INSERT INTO rule_repo_entries (repo, key, search_name, data) VALUES (?, ?, ?, ?)');
          for (const entry of entries) insert.run(id, entry.path, normalizeSearch(entry.name), JSON.stringify(entry));
          this.store.db.prepare('UPDATE rule_repos SET built_at = ?, revisions = ? WHERE id = ?').run(this.now(), JSON.stringify(revisions), id);
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
        if (row.enabled && (row.checked_at === null || this.now() - row.checked_at >= (row.error ? 15 * 60_000 : DAY))) void this.refresh(row.id);
      }
    };
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.all(this.jobs.values());
    await Promise.allSettled(this.details.values());
  }
  private formatDetail(entry: IndexedEntry, preview: string[], count: number | undefined, previewError?: string, rejectedDetails: { line: number; text: string; reason: string }[] = [], rejected = 0) {
    const repo = this.definition(entry.repo);
    return { ...entry, count, license: repo.license, url: `https://github.com/${repo.owner}/${repo.repo}`, preview, previewError, rejected, rejectedDetails,
      variants: entry.variants.map(v => ({ ...v, file: v.files.map(f => f.path).join(' + '), how: '文本托管',
        files: v.files.map(f => ({ ...f, url: rawUrl(repo, f), upstream: upstreamUrl(repo, f) })) })) };
  }
  async resolvedEntry(id: string, path: string): Promise<IndexedEntry> {
    const entry = this.entry(id, path);
    const repo = this.definition(id);
    if (repo.adapter === 'blackmatrix7') {
      for (const client of ['mihomo', 'surge'] as const) {
        const file = entry.variants.find(v => v.client === client)?.files[0];
        if (!file) continue;
        const readme = { ...file, path: file.path.replace(/[^/]+$/, 'README.md') };
        const response = await this.fetcher(rawUrl(repo, readme), { timeoutMs: 20_000 });
        if (response.status !== 200) throw new Error(`使用说明拉取失败：HTTP ${response.status}`);
        applyReadme(entry, client, response.body);
      }
    }
    return entry;
  }
  detail(id: string, path: string) {
    this.entry(id, path);
    const key = `${id}:${path}`;
    const cached = this.details.get(key);
    if (cached) return cached;
    const job = (async () => {
      const entry = await this.resolvedEntry(id, path);
      const variant = this.importVariant(entry);
      const repo = this.definition(id);
      const preview: string[] = [];
      const keys = new Set<string>();
      const rejectedDetails: { line: number; text: string; reason: string }[] = [];
      let rejected = 0;
      try {
        for (const file of variant.files) {
          const response = await this.fetcher(rawUrl(repo, file), { timeoutMs: 20_000 });
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          const parsed = parseRuleSetContent(response.body, file.format, file.behavior);
          if (parsed.passthrough || !parsed.rules.length) throw new Error('文件中没有可解析的规则');
          rejected += parsed.rejected.length;
          rejectedDetails.push(...parsed.rejected.slice(0, Math.max(0, 50 - rejectedDetails.length)).map(r => ({ ...r, text: r.text.slice(0, 500) })));
          for (const rule of parsed.rules) keys.add(ruleKey(rule.rule));
          preview.push(`# 来源：${rawUrl(repo, file)}`, ...response.body.split(/\r?\n/).slice(0, 80));
        }
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
