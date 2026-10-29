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

import { parseContent, stableHash } from '@sub-forge/core';
import type { FetchOptions } from './docs.ts';
import type { UpstreamFetcher } from './net/upstream.ts';
import type { SnapshotOwner, SnapshotRow, Store } from './store.ts';

export const MIN_TTL_SEC = 300;
const FAILURE_RETRY_SEC = 300;

export type SnapshotResult = { snapshot?: SnapshotRow; stale: boolean; error?: string };

/** 内容不可用时返回原因；可用返回 undefined */
export function unusableBody(kind: SnapshotOwner, id: string, body: string): string | undefined {
  if (!body.trim()) return '上游返回了空内容';
  if (kind !== 'source') return undefined;
  const parsed = parseContent(body, { type: 'source', id });
  if (parsed.proxies.length) return undefined;
  return parsed.failures.length ? `上游内容中没有可用节点（${parsed.failures.length} 行无法解析）` : '上游内容中没有可用节点';
}

export class SnapshotService {
  private readonly inflight = new Map<string, Promise<SnapshotRow>>();
  private readonly background = new Set<Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly fetcher: UpstreamFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  /** 拉取一次并写入快照表；失败时写入失败记录并返回它 */
  refresh(kind: SnapshotOwner, id: string, url: string, opts: FetchOptions = {}): Promise<SnapshotRow> {
    const key = `${kind}\u0000${id}\u0000${url}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      const fetchedAt = this.now();
      try {
        const res = await this.fetcher(url, opts);
        const unusable = unusableBody(kind, id, res.body);
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

  async get(kind: SnapshotOwner, id: string, url: string, opts: FetchOptions & { ttlSec: number }): Promise<SnapshotResult> {
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

  /** 等待后台刷新全部结束（测试与优雅退出用） */
  async settled(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }
}
