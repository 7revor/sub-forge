// 上游缓存：下游只调用这里的接口，不关心内容来自缓存还是实时读取。没有定时拉取，请求读到过期内容时才读源。
// 节点：过期后读源最多等待 STALE_WAIT_MS，超时先返回旧内容；失败用旧内容并顺延到下个周期，从未成功时每次请求都重试。
// 规则：到期立刻失效，读源失败直接抛错且不写缓存，下次请求重试。
// 并发读取合并在途请求，相同身份只拉一次；所有上游读取共用并发上限。

import { parseContent, parseRuleSourceContent, stableHash, type RuleSetFormat } from '@sub-forge/core';
import type { FetchOptions, SourceDoc } from './docs.ts';
import { cacheCycleStart } from './cache-cycle.ts';
import { DEFAULT_TIMEOUT_MS, DEFAULT_UA, type UpstreamFetcher, type UpstreamOptions, type UpstreamResponse } from './net/upstream.ts';
import type { RuleFetchParams, SnapshotOwner, SnapshotRow, Store } from './store.ts';

export type { RuleFetchParams } from './store.ts';

const SOURCE_REQUEST_OPTIONS = { ua: DEFAULT_UA, timeoutMs: DEFAULT_TIMEOUT_MS };
/** 已有可用内容时，请求为等待上游刷新最多停留的时间。 */
export const STALE_WAIT_MS = 3000;
/** 周期切换后客户端可能同时请求几十个规则文件；节点和规则共用这个上限。 */
export const MAX_UPSTREAM_READS = 8;

export type NodeSourceRef = Pick<SourceDoc, 'id' | 'url'>;
export type SnapshotResult = { snapshot?: SnapshotRow; revision?: string; stale: boolean; error?: string };
export type RuleContent = { body: string; fetchedAt: number };
export type ResourceStatus = { kind: SnapshotOwner; resource: string; lastSuccessAt?: number; lastAttemptAt?: number; refreshing: boolean; error?: string; available: boolean };

/** 内容不可用时返回原因；可用返回 undefined */
export function unusableBody(kind: SnapshotOwner, id: string, body: string, format: RuleSetFormat = 'auto'): string | undefined {
  if (!body.trim()) return '上游返回了空内容';
  if (kind === 'ruleset') {
    try {
      const parsed = parseRuleSourceContent(body, { format });
      if (parsed.binary || parsed.rules.length) return undefined;
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
  private readonly nodeReads = new Map<string, Promise<SnapshotRow>>();
  private readonly ruleReads = new Map<string, Promise<RuleContent>>();
  private readonly previews = new Map<string, Promise<{ body?: string; error?: string }>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly store: Store, private readonly fetcher: UpstreamFetcher, private readonly now: () => number = Date.now) {}

  private cycleStart(): number { return cacheCycleStart(this.now(), this.store.resourceCacheTtlSec); }
  private nextFetchedAt(kind: SnapshotOwner, id: string, url: string): number {
    return Math.max(this.now(), (this.store.latestSnapshotMeta(kind, id, url, false)?.fetchedAt ?? -1) + 1);
  }
  private async read(url: string, request: UpstreamOptions): Promise<UpstreamResponse> {
    if (this.active >= MAX_UPSTREAM_READS) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await this.fetcher(url, request); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }

  // ---------- 节点订阅 ----------

  private revision(snapshot: SnapshotRow): string {
    const success = this.store.latestSnapshotMeta(snapshot.ownerKind, snapshot.ownerId, snapshot.url);
    const attempt = this.store.latestSnapshotMeta(snapshot.ownerKind, snapshot.ownerId, snapshot.url, false);
    return JSON.stringify([success?.id, success?.fetchedAt, success?.hash, attempt?.id, attempt?.fetchedAt]);
  }
  isCurrent(snapshot: SnapshotRow, revision: string | undefined): boolean {
    return this.revision(snapshot) === revision;
  }
  nodeKey(source: NodeSourceRef): string { return `source:${source.id}`; }
  nodeStatus(source: NodeSourceRef): ResourceStatus {
    const success = this.store.latestSnapshotMeta('source', source.id, source.url);
    const attempt = this.store.latestSnapshotMeta('source', source.id, source.url, false);
    return { kind: 'source', resource: this.nodeKey(source), lastSuccessAt: success?.fetchedAt, lastAttemptAt: attempt?.fetchedAt,
      refreshing: this.nodeReads.has(JSON.stringify([source.id, source.url])), error: attempt && !attempt.ok ? attempt.error : undefined, available: !!success };
  }
  /** 手动刷新和过期读取共用：成功替换旧内容；失败写一条失败记录，旧内容不动。 */
  refreshNodeSource(source: NodeSourceRef): Promise<SnapshotRow> {
    // 在途键带 URL：换地址后的新请求不能合并到旧地址的请求上。
    const key = JSON.stringify([source.id, source.url]);
    const running = this.nodeReads.get(key);
    if (running) return running;
    const { id, url } = source;
    // 晚到的响应：订阅源已删除或换了地址，结果不能落库。
    const discarded = (error: string): SnapshotRow => ({ ownerKind: 'source', ownerId: id, id: 0, url, fetchedAt: this.now(), ok: false, error });
    const superseded = () => this.store.get('source', id)?.url !== url;
    const p = (async () => {
      // 先进入微任务，确保同步失败也能正确清理在途表。
      await Promise.resolve();
      try {
        const res = await this.read(url, SOURCE_REQUEST_OPTIONS);
        const unusable = unusableBody('source', id, res.body);
        if (unusable) throw new Error(unusable);
        if (superseded()) return discarded('订阅源在读取期间已变化');
        const fetchedAt = this.nextFetchedAt('source', id, url);
        const hash = stableHash(res.body);
        const previous = this.store.latestSnapshot('source', id, url);
        if (previous?.hash === hash) {
          this.store.touchSnapshot(previous.id, { fetchedAt, status: res.status, userinfo: res.userinfo });
          return this.store.latestSnapshot('source', id, url)!;
        }
        return this.store.addSnapshot({ ownerKind: 'source', ownerId: id, url, fetchedAt, ok: true, status: res.status, body: res.body, hash, ...(res.userinfo ? { userinfo: res.userinfo } : {}) });
      } catch (error) {
        const message = (error as Error).message;
        if (superseded()) return discarded(message);
        return this.store.addSnapshot({ ownerKind: 'source', ownerId: id, url, fetchedAt: this.nextFetchedAt('source', id, url), ok: false, error: message });
      } finally {
        this.nodeReads.delete(key);
        this.store.changed();
      }
    })();
    this.nodeReads.set(key, p);
    return p;
  }
  async getNodeSource(source: NodeSourceRef): Promise<SnapshotResult> {
    const { id, url } = source;
    const current = () => {
      const latest = this.store.latestSnapshot('source', id, url);
      return { snapshot: latest, revision: latest ? this.revision(latest) : undefined };
    };
    const attempt = this.store.latestSnapshotMeta('source', id, url, false);
    if (!this.store.latestSnapshotMeta('source', id, url)) {
      // 从未成功：没有旧内容可用，不按周期退避，本次请求等待重试。
      const row = await this.refreshNodeSource(source);
      return row.ok ? { ...current(), stale: false } : { stale: false, error: row.error };
    }
    // 本周期已尝试过：成功就用缓存；失败继续用旧内容并告警，下个周期再试。
    if (attempt && attempt.fetchedAt >= this.cycleStart()) return { ...current(), stale: !attempt.ok, error: attempt.ok ? undefined : attempt.error };
    const row = await this.within(STALE_WAIT_MS, this.refreshNodeSource(source));
    if (!row) return { ...current(), stale: true, error: '上游响应较慢，本次使用旧快照，正在后台更新' };
    return { ...current(), stale: !row.ok, error: row.ok ? undefined : row.error };
  }
  /** 限时等待刷新；超时返回 undefined，刷新本身不取消。 */
  private async within<T>(waitMs: number, work: Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), waitMs); })]); }
    finally { clearTimeout(timer); }
  }
  /** 订阅源草稿：只读取临时预览，不写快照。 */
  previewSource(id: string, url: string): Promise<{ body?: string; error?: string }> {
    const key = JSON.stringify([id, url]);
    const running = this.previews.get(key);
    if (running) return running;
    const result = (async () => {
      try {
        const response = await this.read(url, SOURCE_REQUEST_OPTIONS);
        const error = unusableBody('source', id, response.body);
        return error ? { error } : { body: response.body };
      } catch (error) { return { error: (error as Error).message }; }
    })().finally(() => this.previews.delete(key));
    this.previews.set(key, result);
    return result;
  }

  // ---------- 规则内容 ----------

  ruleStatus(url: string, params: RuleFetchParams = {}): ResourceStatus {
    const key = this.store.ruleSnapshotKey(url, params);
    const row = this.store.latestSnapshotMeta('ruleset', key, url);
    // 过期行可能还没清理，但已经不算可用内容。
    const valid = row && row.fetchedAt >= this.cycleStart() ? row : undefined;
    return { kind: 'ruleset', resource: key, lastSuccessAt: valid?.fetchedAt, lastAttemptAt: valid?.fetchedAt, refreshing: this.ruleReads.has(key), available: !!valid };
  }
  /** 手动刷新和过期读取共用：成功写入缓存；失败抛错且不写表，本周期仍有效的快照保留。 */
  refreshRuleContent(url: string, params: RuleFetchParams = {}): Promise<RuleContent> {
    const key = this.store.ruleSnapshotKey(url, params);
    const running = this.ruleReads.get(key);
    if (running) return running;
    const format = params.format ?? 'auto';
    const p = (async () => {
      await Promise.resolve();
      try {
        if (format === 'srs') throw new Error('暂不支持 SRS 资源托管，请使用文本或 MRS 来源');
        const res = await this.read(url, { ua: params.ua ?? DEFAULT_UA, timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS, ruleContent: true, rawMrs: format === 'mrs', mrsBehavior: format === 'mrs' ? params.behavior : undefined });
        if (format === 'mrs' && !res.body.startsWith('#subforge-binary-mrs\n')) throw new Error(unusableBody('ruleset', key, res.body, format) ?? '上游没有返回有效 MRS 文件');
        const unusable = format === 'mrs' ? undefined : unusableBody('ruleset', key, res.body, format);
        if (unusable) throw new Error(unusable);
        const fetchedAt = this.nextFetchedAt('ruleset', key, url);
        this.store.addSnapshot({ ownerKind: 'ruleset', ownerId: key, url, fetchedAt, ok: true, status: res.status, body: res.body, hash: stableHash(res.body) });
        return { body: res.body, fetchedAt };
      } finally {
        this.ruleReads.delete(key);
        this.store.changed();
      }
    })();
    this.ruleReads.set(key, p);
    return p;
  }
  /** 本周期已成功拉取就用缓存；否则读源并等待，失败直接抛错。过期内容不作为旧数据返回。 */
  async getRuleContent(url: string, params: RuleFetchParams = {}): Promise<RuleContent> {
    const row = this.store.latestSnapshot('ruleset', this.store.ruleSnapshotKey(url, params), url);
    if (row?.body !== undefined && row.fetchedAt >= this.cycleStart()) return { body: row.body, fetchedAt: row.fetchedAt };
    return this.refreshRuleContent(url, params);
  }
  /** 规则草稿：不写快照，也不校验内容。 */
  async peekRuleContent(url: string, opts: FetchOptions = {}): Promise<{ body?: string; error?: string }> {
    try { return { body: (await this.read(url, { ua: opts.ua, timeoutMs: opts.timeoutMs, ruleContent: true })).body }; }
    catch (error) { return { error: (error as Error).message }; }
  }
  async settled(): Promise<void> {
    const running = () => [...this.nodeReads.values(), ...this.ruleReads.values(), ...this.previews.values()];
    while (running().length) await Promise.allSettled(running());
  }
}
