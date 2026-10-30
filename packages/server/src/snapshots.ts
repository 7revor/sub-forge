// 统一资源缓存：到期等待刷新，失败保留最后一次成功内容并延后一个系统周期。
// 已完成草稿不缓存；并发读取只合并在途请求。

import { parseContent, parseRuleSourceContent, stableHash, type RuleSetFormat } from '@sub-forge/core';
import type { FetchOptions } from './docs.ts';
import { DEFAULT_TIMEOUT_MS, DEFAULT_UA, type UpstreamFetcher } from './net/upstream.ts';
import type { SnapshotOwner, SnapshotRow, Store } from './store.ts';

const SOURCE_REQUEST_OPTIONS = { ua: DEFAULT_UA, timeoutMs: DEFAULT_TIMEOUT_MS };

export type SnapshotResult = { snapshot?: SnapshotRow; revision?: string; stale: boolean; error?: string };
export type SnapshotFetchOptions = FetchOptions & { format?: RuleSetFormat; behavior?: 'domain' | 'ipcidr' | 'classical'; scope?: string };

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
  private readonly inflight = new Map<string, Promise<SnapshotRow>>();
  private readonly previews = new Map<string, Promise<{ body?: string; error?: string }>>();
  constructor(private readonly store: Store, private readonly fetcher: UpstreamFetcher, private readonly now: () => number = Date.now) {}
  private options(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions): SnapshotFetchOptions {
    if (kind === 'source') return { ...SOURCE_REQUEST_OPTIONS, scope: opts.scope };
    const source = this.store.get('ruleset', id)?.sources.find(s => s.url === url);
    const format = opts.format ?? source?.format ?? 'auto';
    return { ...(format === 'mrs' ? { behavior: opts.behavior ?? source?.behavior } : {}), ua: opts.ua ?? DEFAULT_UA, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, format, scope: 'public-rules' };
  }
  identity(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions = {}): string {
    const { scope, ...options } = this.options(kind, id, url, opts);
    const saved = this.store.getWithOwner(kind, id);
    const sources = kind === 'ruleset' ? this.store.get('ruleset', id)?.sources.filter(s => s.url === url) : undefined;
    const compatible = !sources?.length ? !options.ua || options.ua === DEFAULT_UA : sources.every(source =>
      options.ua === (source.fetch?.ua ?? DEFAULT_UA) && options.timeoutMs === (source.fetch?.timeoutMs ?? DEFAULT_TIMEOUT_MS) && options.format === source.format && (options.format !== 'mrs' || options.behavior === source.behavior));
    // 升级旧快照时不能把旧参数或旧权限的正文绑定到本次草稿读取身份。
    const migrateLegacy = compatible && (!scope || !saved?.owner || scope === saved.owner || kind === 'ruleset' && scope === 'public-rules');
    return this.store.bindResource(kind, id, url, options, scope, !!migrateLegacy);
  }
  private revision(snapshot: SnapshotRow): string {
    const success = this.store.latestSnapshot(snapshot.ownerKind,snapshot.ownerId,snapshot.url);
    const attempt = this.store.latestSnapshot(snapshot.ownerKind,snapshot.ownerId,snapshot.url,false);
    return JSON.stringify([success?.id,success?.fetchedAt,success?.hash,attempt?.id,attempt?.fetchedAt]);
  }
  isCurrent(snapshot: SnapshotRow, revision: string | undefined): boolean {
    return this.revision(snapshot) === revision;
  }
  status(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions = {}) {
    const resource = this.identity(kind,id,url,opts);
    const success = this.store.latestSnapshot(kind,resource,url);
    const attempt = this.store.latestSnapshot(kind,resource,url,false);
    return { resource, lastSuccessAt: success?.fetchedAt, lastAttemptAt: attempt?.fetchedAt,
      nextFetchAt: attempt ? attempt.fetchedAt + this.store.resourceCacheTtlSec * 1000 : undefined,
      refreshing: this.inflight.has(resource), error: attempt && !attempt.ok ? attempt.error : undefined, available: !!success };
  }
  previewSource(id: string, url: string): Promise<{ body?: string; error?: string }> {
    const key = JSON.stringify([id,url]);
    const running = this.previews.get(key);
    if (running) return running;
    const result = (async () => {
      try {
        const response = await this.fetcher(url,SOURCE_REQUEST_OPTIONS);
        const error = unusableBody('source',id,response.body);
        return error ? { error } : { body: response.body };
      } catch (error) { return { error: (error as Error).message }; }
    })().finally(() => this.previews.delete(key));
    this.previews.set(key,result);
    return result;
  }
  refresh(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions = {}): Promise<SnapshotRow> {
    opts = this.options(kind, id, url, opts);
    const resource = this.identity(kind,id,url,opts);
    const running = this.inflight.get(resource);
    if (running) return running;
    const p = (async () => {
      // 先进入微任务，确保同步失败也能正确清理在途表。
      await Promise.resolve();
      try {
        if (opts.format === 'srs') throw new Error('暂不支持 SRS 资源托管，请使用文本或 MRS 来源');
        const res = await this.fetcher(url,kind === 'source' ? SOURCE_REQUEST_OPTIONS : { ua: opts.ua, timeoutMs: opts.timeoutMs, ruleContent: true, rawMrs: opts.format === 'mrs', mrsBehavior: opts.behavior });
        const unusable = opts.format === 'mrs' && res.body.startsWith('#subforge-binary-mrs\n') ? undefined : unusableBody(kind,id,res.body,opts.format);
        if (unusable) throw new Error(unusable);
        if (opts.format === 'mrs' && !res.body.startsWith('#subforge-binary-mrs\n')) throw new Error('上游没有返回有效 MRS 文件');
        const previous = this.store.latestSnapshot(kind,resource,url,false);
        const fetchedAt = Math.max(this.now(),(previous?.fetchedAt ?? -1) + 1);
        const hash = stableHash(res.body);
        const prev = this.store.latestSnapshot(kind,resource,url);
        if (prev?.hash === hash) {
          this.store.touchSnapshot(prev.id,{ fetchedAt,status:res.status,userinfo:res.userinfo });
          return this.store.latestSnapshot(kind,resource,url)!;
        }
        return this.store.addSnapshot({ ownerKind:kind,ownerId:resource,url,fetchedAt,ok:true,status:res.status,body:res.body,hash,...(res.userinfo ? {userinfo:res.userinfo} : {}) });
      } catch (error) {
        const previous = this.store.latestSnapshot(kind,resource,url,false);
        return this.store.addSnapshot({ ownerKind:kind,ownerId:resource,url,fetchedAt:Math.max(this.now(),(previous?.fetchedAt ?? -1)+1),ok:false,error:(error as Error).message });
      } finally {
        this.inflight.delete(resource);
        // 删除时已撤销绑定；晚到的拉取不能复活无引用的缓存。
        this.store.pruneUnusedResource(resource);
        this.store.changed();
      }
    })();
    this.inflight.set(resource,p);
    return p;
  }
  async get(kind: SnapshotOwner, id: string, url: string, opts: SnapshotFetchOptions = {}, policy: { waitForFresh?: boolean; refresh?: boolean } = {}): Promise<SnapshotResult> {
    const status = this.status(kind,id,url,opts);
    let latest = this.store.latestSnapshot(kind,status.resource,url);
    if (policy.refresh || status.nextFetchAt === undefined || this.now() >= status.nextFetchAt || status.refreshing) {
      const row = await this.refresh(kind,id,url,opts);
      // 在途校验可以使用本次成功响应的副本；引用被清理时不重新落库。
      // 正式下载的资源存在性和归属由调用方在 await 后复核。
      latest = this.store.latestSnapshot(kind,status.resource,url) ?? (row.ok ? row : undefined);
      return { snapshot:latest,revision:latest ? this.revision(latest) : undefined,stale:!row.ok && !!latest,error:row.ok ? undefined : row.error };
    }
    return { snapshot:latest,revision:latest ? this.revision(latest) : undefined,stale:!!status.error && !!latest,error:status.error };
  }
  async peek(url: string, opts: SnapshotFetchOptions = {}): Promise<{ body?: string; error?: string }> {
    const result = await this.peekRuleContent(url,opts);
    if (result.body !== undefined) {
      const error = unusableBody('ruleset','',result.body,opts.format);
      if (error) return { error };
    }
    return result;
  }
  async peekRuleContent(url: string, opts: FetchOptions = {}): Promise<{ body?: string; error?: string }> {
    try { return { body: (await this.fetcher(url,{ ua:opts.ua,timeoutMs:opts.timeoutMs,ruleContent:true })).body }; }
    catch (error) { return { error:(error as Error).message }; }
  }
  async settled(): Promise<void> { while (this.inflight.size || this.previews.size) await Promise.all([...this.inflight.values(),...this.previews.values()]); }
}
