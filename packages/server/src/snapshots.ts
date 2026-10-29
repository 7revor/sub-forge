// 快照服务：订阅请求从不等待上游（stale-while-revalidate，03 §7）。
// - 有快照且未过期：直接用；
// - 有快照但已过期：先用旧快照，后台刷新；
// - 从未拉取成功：只能同步拉取一次。
// 同一 URL 的并发拉取合并为一次。拉取失败记入快照表（UI 标红），不抛出。
// 上游返回 2xx 但内容为空（或订阅源解析不出任何节点）同样记为失败：机场在 token 过期、
// 限流时常这样返回，若当作成功快照，会顶掉上一份可用内容，订阅变成空的。

import { parseContent, parseRuleSetContent, stableHash, type RuleSetFormat } from '@sub-forge/core';
import type { FetchOptions } from './docs.ts';
import type { UpstreamFetcher } from './net/upstream.ts';
import type { SnapshotOwner, SnapshotRow, Store } from './store.ts';

export type SnapshotResult = { snapshot?: SnapshotRow; stale: boolean; error?: string };

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
        const unusable = unusableBody(kind, id, res.body, kind === 'ruleset' ? this.store.get('ruleset', id)?.format : undefined);
        if (unusable) throw new Error(unusable);
        const row = { ownerKind: kind, ownerId: id, url, fetchedAt, ok: true, status: res.status, body: res.body, hash: stableHash(res.body), ...(res.userinfo ? { userinfo: res.userinfo } : {}) };
        this.store.addSnapshot(row);
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
    if (!latest) {
      const row = await this.refresh(kind, id, url, opts);
      return row.ok ? { snapshot: row, stale: false } : { stale: false, ...(row.error ? { error: row.error } : {}) };
    }
    const stale = this.now() - latest.fetchedAt > opts.ttlSec * 1000;
    if (stale) {
      const p = this.refresh(kind, id, url, opts);
      this.background.add(p);
      void p.finally(() => this.background.delete(p));
    }
    const lastFailure = this.store.latestSnapshot(kind, id, url, false);
    const failedAfter = lastFailure && !lastFailure.ok && lastFailure.fetchedAt >= latest.fetchedAt ? lastFailure.error : undefined;
    return { snapshot: latest, stale, ...(failedAfter ? { error: failedAfter } : {}) };
  }

  /** 等待后台刷新全部结束（测试与优雅退出用） */
  async settled(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }
}
