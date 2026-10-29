// 上游拉取：自定义 UA、超时、手动跟随重定向（逐跳校验）、响应大小上限、透传 subscription-userinfo（SRC-02 / SRC-05）。

import { decodeRuleBytes } from './mrs.ts';
import { fetch as undiciFetch } from 'undici';
import type { TrafficInfo } from '../store.ts';
import { assertUrlAllowed, SsrfError, type AllowList } from './ssrf.ts';

export class UpstreamError extends Error {}

export type UpstreamResponse = { status: number; body: string; userinfo?: TrafficInfo };
export type UpstreamOptions = { ua?: string; timeoutMs?: number; ruleContent?: boolean };
export type UpstreamFetcher = (url: string, opts?: UpstreamOptions) => Promise<UpstreamResponse>;

/** 只用到 fetch 响应的这几个成员，便于测试替换 */
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}>;

export const DEFAULT_UA = 'clash.meta';
export const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export function parseUserinfo(header: string | null): TrafficInfo | undefined {
  if (!header) return undefined;
  const out: TrafficInfo = {};
  for (const part of header.split(';')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === 'upload' || k === 'download' || k === 'total' || k === 'expire') out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * undici 把建连失败包成 TypeError('fetch failed')，真正原因在 cause 链里。
 * 拆出来：SSRF 拦截原样抛出，其余用最底层的原因作为错误信息。
 */
function unwrapFetchError(e: unknown): Error {
  let cur: unknown = e;
  let deepest: Error = e instanceof Error ? e : new Error(String(e));
  for (let i = 0; cur instanceof Error && i < 8; i++) {
    if (cur instanceof SsrfError) return cur;
    deepest = cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return deepest === e ? deepest : new UpstreamError(deepest.message);
}

export function createUpstreamFetcher(opts: { allow: AllowList; fetchImpl?: FetchLike; maxBytes?: number }): UpstreamFetcher {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => undiciFetch(url, init));

  return async (rawUrl, o = {}) => {
    const signal = AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = { 'user-agent': o.ua ?? DEFAULT_UA };
    let url = new URL(rawUrl);
    for (let hop = 0; ; hop++) {
      assertUrlAllowed(url, opts.allow);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchImpl(url.toString(), { headers, signal, redirect: 'manual' });
      } catch (e) {
        throw unwrapFetchError(e);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new UpstreamError(`HTTP ${res.status} 缺少 Location`);
        if (hop >= MAX_REDIRECTS) throw new UpstreamError('重定向次数过多');
        url = new URL(loc, url);
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new UpstreamError(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > maxBytes) throw new UpstreamError(`响应过大（${len} 字节）`);
      const bytes = o.ruleContent && res.arrayBuffer ? Buffer.from(await res.arrayBuffer()) : undefined;
      if (bytes && bytes.length > maxBytes) throw new UpstreamError(`响应过大（${bytes.length} 字节）`);
      const body = bytes ? await decodeRuleBytes(bytes) : await res.text();
      if (body.length > maxBytes) throw new UpstreamError(`响应过大（${body.length} 字符）`);
      const userinfo = parseUserinfo(res.headers.get('subscription-userinfo'));
      return userinfo ? { status: res.status, body, userinfo } : { status: res.status, body };
    }
  };
}
