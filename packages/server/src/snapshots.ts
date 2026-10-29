// 快照服务：订阅请求从不等待上游（stale-while-revalidate，03 §7）。
// - 有快照且未过期：直接用；
// - 有快照但已过期：先用旧快照，后台刷新；
// - 从未拉取成功：只能同步拉取一次。
// 同一 URL 的并发拉取合并为一次。拉取失败记入快照表（UI 标红），不抛出。
// 拉取成功但内容与最近一份成功快照相同：只更新那一份的拉取时间，不新增，保留最近 N 份不同内容。
// 拉取失败后，距上次失败不足 min(TTL, 5 分钟) 时不再重试，避免上游持续失败时每个订阅请求都去拉一次；
// 手动刷新（refresh）不受此限制。TTL 最短 5 分钟（PRD 非功能需求），更短的旧数据按 5 分钟算。
// 上游返回 2xx 但内容为空（或订阅源解析不出任何节点）同样记为失败：机场在 token 过期、
// 限流时常这样返回，若当作成功快照，会顶掉上一份可用内容，订阅变成空的。

import { parseContent, parseRuleSetContent, stableHash, type RuleSetFormat } from '@sub-forge/core';
import type { FetchOptions } from './docs.ts';
import { DEFAULT_TIMEOUT_MS, DEFAULT_UA, type UpstreamFetcher } from './net/upstream.ts';
import type { SnapshotOwner, SnapshotRow, Store } from './store.ts';

export const MIN_TTL_SEC = 300;
const FAILURE_RETRY_SEC = 300;

export type SnapshotResult = { snapshot?: SnapshotRow; stale: boolean; error?: string };
export type SnapshotFetchOptions = FetchOptions & { format?: RuleSetFormat };

/** 内容不可用时返回原因；可用返回 undefined */
export function unusableBody(kind: SnapshotOwner, id: string, body: string, format: RuleSetFormat = 'auto'): string | undefined {
  if (!body.trim()) return '上游返回了空内容';
  if (kind === 'ruleset') {
    try {
      const parsed = parseRuleSetContent(body, format);
      if (parsed.passthrough || parsed.rules.length) return undefined;
      return `上游内容中没有可用规则（${parsed.rejected.length} 行无法解析）`;
    } catch (e) {
      return `规则集内容无法解析：${(e as Error).message}`;
    }
  }
  const parsed = parseContent(body, { type: 'source', id });
  if (parsed.proxies.length) return undefined;
  return parsed.failures.length ? `上游内容中没有可用节点（${parsed.failures.length} 行无法解析）` : '上游内容中没有可用节点';
}

export class SnapshotService {
  private readonly inflight = new Map<string, Promise<SnapshotRow>>();
  private readonly background = new Set<Promise<unknown>>();
  private readonly previews = new Map<string, { at: number; result: Promise<{ body?: string; error?: string }> }>();

  constructor(
    private readonly store: Store,
    private readonly fetcher: UpstreamFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  /** 草稿拉取只保留短期内存缓存，不改正式快照；处理链编辑复用相同参数的内容。 */
  previewSource(id: string, url: string, opts: FetchOptions = {}): Promise<{ body?: string; error?: string }> {
    const key = JSON.stringify([id, url, opts.ua ?? DEFAULT_UA, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS]);
    for (const [entry, value] of this.previews) if (this.now() - value.at >= 60_000) this.previews.delete(entry);
    const cached = this.previews.get(key);
    if (cached && this.now() - cached.at < 60_000) return cached.result;
    const result = (async () => {
      try {
        const response = await this.fetcher(url, opts);
        const error = unusableBody('source', id, response.body);
        return error ? { error } : { body: response.body };
      } catch (e) {
        return { error: (e as Error).message };
      }
    })();
    this.previews.delete(key);
    this.previews.set(key, { at: this.now(), result });
    while (this.previews.size > 16) this.previews.delete(this.previews.keys().next().value!);
    this.background.add(result);
    void result.finally(() => this.background.delete(result));
    return result;
  }

  /** 拉取一次并写入快照表；失败时写入失败记录并返回它。规则集来源带上 format 以检查内容是否可用 */
  refresh(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions = {}): Promise<SnapshotRow> {
    const key = `${kind}\u0000${id}\u0000${url}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      const fetchedAt = this.now();
      try {
        const { format, ...fetchOpts } = opts;
        const res = await this.fetcher(url, fetchOpts);
        const unusable = unusableBody(kind, id, res.body, format);
        if (unusable) throw new Error(unusable);
        const hash = stableHash(res.body);
        const prev = this.store.latestSnapshot(kind, id, url);
        if (prev?.hash === hash) this.store.touchSnapshot(prev.id, { fetchedAt, status: res.status, ...(res.userinfo ? { userinfo: res.userinfo } : {}) });
        else this.store.addSnapshot({ ownerKind: kind, ownerId: id, url, fetchedAt, ok: true, status: res.status, body: res.body, hash, ...(res.userinfo ? { userinfo: res.userinfo } : {}) });
        return this.store.latestSnapshot(kind, id, url)!;
      } catch (e) {
        this.store.addSnapshot({ ownerKind: kind, ownerId: id, url, fetchedAt, ok: false, error: (e as Error).message });
        return this.store.latestSnapshot(kind, id, url, false)!;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  async get(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions & { ttlSec: number }): Promise<SnapshotResult> {
    const latest = this.store.latestSnapshot(kind, id, url);
    const lastFailure = this.store.latestSnapshot(kind, id, url, false);
    const failure = lastFailure && !lastFailure.ok && (!latest || lastFailure.fetchedAt >= latest.fetchedAt) ? lastFailure : undefined;
    const ttlSec = Math.max(opts.ttlSec, MIN_TTL_SEC);
    const backoff = !!failure && this.now() - failure.fetchedAt < Math.min(ttlSec, FAILURE_RETRY_SEC) * 1000;
    if (!latest) {
      if (backoff) return { stale: false, ...(failure!.error ? { error: failure!.error } : {}) };
      const row = await this.refresh(kind, id, url, opts);
      return row.ok ? { snapshot: row, stale: false } : { stale: false, ...(row.error ? { error: row.error } : {}) };
    }
    const stale = this.now() - latest.fetchedAt > ttlSec * 1000;
    if (stale && !backoff) {
      const p = this.refresh(kind, id, url, opts);
      this.background.add(p);
      void p.finally(() => this.background.delete(p));
    }
    return { snapshot: latest, stale, ...(failure?.error ? { error: failure.error } : {}) };
  }

  /**
   * 只拉取、不写快照表：用于尚未保存的规则集草稿预览（还没有 id，快照无处归属）。
   * 内容不可用时与快照拉取一样返回原因。
   */
  async peek(url: string, opts: SnapshotFetchOptions = {}): Promise<{ body?: string; error?: string }> {
    const { format, ...fetchOpts } = opts;
    try {
      const res = await this.fetcher(url, fetchOpts);
      const unusable = unusableBody('ruleset', '', res.body, format);
      return unusable ? { error: unusable } : { body: res.body };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /** 等待后台刷新全部结束（测试与优雅退出用） */
  async settled(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }
}
