// 订阅内容解析入口：自动识别 Clash YAML / Surge [Proxy] / Base64 / URI 列表（SRC-01、SRC-04）。
// 单个节点解析失败只记入 failures，不中断整体。

import { isMap, isSeq, parseDocument } from 'yaml';
import type { NodeSetID, ProxyIR } from '../types.ts';
import { tryDecodeBase64 } from '../util/base64.ts';
import { proxyKey } from './key.ts';
import type { RawProxy } from './raw.ts';
import { isLoonLine, parseLoonLine } from './loon.ts';
import { parseSurgeLine } from './surge.ts';
import { parseUri } from './uri.ts';

export type ParseFailure = { line: string; reason: string };
export type ContentFormat = 'clash' | 'surge' | 'loon' | 'uri' | 'base64' | 'empty';
export type ParseResult = { format: ContentFormat; proxies: ProxyIR[]; failures: ParseFailure[] };

function tryClashYaml(text: string): unknown[] | undefined {
  const doc = parseDocument(text);
  const root = doc.contents;
  const isProxyMap = (node: unknown) => isMap(node) && ['name', 'type', 'server', 'port'].some((key) => node.has(key));
  // 先检查结构，避免把 URI 标量或 Surge 的 [Proxy] 段误认为 YAML 节点。
  const wrapped = isMap(root) && root.has('proxies');
  const list = isSeq(root) && (root.items.length === 0 || root.items.some(isProxyMap));
  if (!wrapped && !list && !isProxyMap(root)) return undefined;
  if (doc.errors.length) throw doc.errors[0];

  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (Array.isArray(value)) return value;
  if (wrapped) {
    const proxies = (value as { proxies: unknown }).proxies;
    if (!Array.isArray(proxies)) throw new Error('proxies 必须是节点列表');
    return proxies;
  }
  return [value];
}

function looksLikeSurge(text: string): boolean {
  if (/^\s*\[Proxy\]\s*$/m.test(text)) return true;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith(';'));
  return lines.length > 0 && lines.every((l) => /^[^=]+=\s*[a-z0-9-]+\s*,/i.test(l) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(l));
}

/** 只取 [Proxy] 段（没有段标题时视为整段都是节点） */
function surgeProxyLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const hasSection = lines.some((l) => /^\s*\[Proxy\]\s*$/.test(l));
  const out: string[] = [];
  let inProxy = !hasSection;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^\[.+\]$/.test(l)) { inProxy = l === '[Proxy]'; continue; }
    if (!inProxy || !l || l.startsWith('#') || l.startsWith(';') || l.startsWith('//')) continue;
    out.push(l);
  }
  return out;
}

function fromClashObject(o: unknown): RawProxy {
  if (!o || typeof o !== 'object') throw new Error('不是对象');
  const r = o as Record<string, unknown>;
  const port = Number(r.port);
  if (typeof r.name !== 'string' || typeof r.type !== 'string' || typeof r.server !== 'string' || !(port > 0 && port < 65536)) {
    throw new Error('缺少 name / type / server / port');
  }
  return { ...r, name: r.name, type: r.type, server: r.server, port };
}

export function finalizeProxy(raw: RawProxy, nodeSet: NodeSetID): ProxyIR {
  const { 'dialer-proxy': dialer, 'underlying-proxy': underlying, ...rest } = raw;
  const name = String(rest.name).trim() || `${rest.server}:${rest.port}`;
  const up = typeof dialer === 'string' && dialer ? dialer : typeof underlying === 'string' && underlying ? underlying : undefined;
  const p: ProxyIR = { ...rest, name, _source: nodeSet, _origName: name, _key: proxyKey(rest) };
  if (up !== undefined) p.upstreamDialer = up;
  return p;
}

export function parseContent(text: string, nodeSet: NodeSetID): ParseResult {
  const proxies: ProxyIR[] = [];
  const failures: ParseFailure[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { format: 'empty', proxies, failures };

  const collect = (items: unknown[], toRaw: (x: unknown) => RawProxy | undefined, show: (x: unknown) => string) => {
    for (const item of items) {
      try {
        const raw = toRaw(item);
        if (raw) proxies.push(finalizeProxy(raw, nodeSet));
      } catch (e) {
        failures.push({ line: show(item), reason: (e as Error).message });
      }
    }
  };

  // 保留首行缩进，否则从配置中复制的整体缩进片段会被 trim 破坏层级。
  const clash = tryClashYaml(text);
  if (clash) {
    collect(clash, fromClashObject, (x) => JSON.stringify(x));
    return { format: 'clash', proxies, failures };
  }

  if (looksLikeSurge(trimmed)) {
    let loon = false;
    collect(surgeProxyLines(trimmed), (l) => {
      const text = l as string;
      if (isLoonLine(text)) { loon = true; return parseLoonLine(text); }
      return parseSurgeLine(text);
    }, String);
    return { format: loon ? 'loon' : 'surge', proxies, failures };
  }

  let format: ContentFormat = 'uri';
  let body = trimmed;
  if (!/:\/\//.test(body)) {
    const decoded = tryDecodeBase64(body);
    if (decoded !== undefined && /:\/\//.test(decoded)) { body = decoded.trim(); format = 'base64'; }
  }
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  collect(lines, (l) => parseUri(l as string), String);
  return { format, proxies, failures };
}
