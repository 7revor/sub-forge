// 分享链接（URI）解析。输出字段对齐 mihomo 的 proxies 写法。
// 首期覆盖主流协议；不支持的协议抛出 UnsupportedError，由上层列入"解析失败"而不中断（SRC-04）。

import { decodeBase64, tryDecodeBase64 } from '../util/base64.ts';
import type { RawProxy } from './raw.ts';

export class UnsupportedError extends Error {}

type UriParts = {
  scheme: string;
  userinfo?: string;
  host: string;
  port: number;
  path: string;
  query: URLSearchParams;
  name: string;
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function splitUri(uri: string): UriParts {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(uri);
  if (!m) throw new Error('不是 URI');
  const scheme = m[1]!.toLowerCase();
  let rest = m[2]!;
  let name = '';
  const hashAt = rest.indexOf('#');
  if (hashAt >= 0) { name = safeDecode(rest.slice(hashAt + 1)); rest = rest.slice(0, hashAt); }
  let query = new URLSearchParams();
  const qAt = rest.indexOf('?');
  if (qAt >= 0) { query = new URLSearchParams(rest.slice(qAt + 1)); rest = rest.slice(0, qAt); }
  let path = '';
  const slashAt = rest.indexOf('/');
  if (slashAt >= 0) { path = rest.slice(slashAt); rest = rest.slice(0, slashAt); }
  let userinfo: string | undefined;
  const atAt = rest.lastIndexOf('@');
  if (atAt >= 0) { userinfo = rest.slice(0, atAt); rest = rest.slice(atAt + 1); }
  const hp = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(rest);
  if (!hp) throw new Error(`无法解析服务器与端口：${rest}`);
  const host = hp[1]!.replace(/^\[|\]$/g, '');
  const port = Number(hp[2]);
  if (!(port > 0 && port < 65536)) throw new Error(`端口非法：${hp[2]}`);
  return userinfo === undefined
    ? { scheme, host, port, path, query, name }
    : { scheme, userinfo, host, port, path, query, name };
}

const truthy = (v: string | null) => v !== null && ['1', 'true', 'yes'].includes(v.toLowerCase());

/** ws / grpc / h2 / http 传输层参数（vless / trojan / vmess 共用） */
function applyTransport(p: RawProxy, network: string | null, q: { path?: string | null; host?: string | null; serviceName?: string | null }): void {
  const net = (network || 'tcp').toLowerCase();
  if (net === 'tcp' || net === 'raw') return;
  p.network = net;
  if (net === 'ws' || net === 'httpupgrade') {
    const opts: Record<string, unknown> = { path: q.path || '/' };
    if (q.host) opts.headers = { Host: q.host };
    if (net === 'httpupgrade') opts['v2ray-http-upgrade'] = true;
    p.network = 'ws';
    p['ws-opts'] = opts;
  } else if (net === 'grpc') {
    p['grpc-opts'] = { 'grpc-service-name': q.serviceName || q.path || '' };
  } else if (net === 'h2') {
    const opts: Record<string, unknown> = { path: q.path || '/' };
    if (q.host) opts.host = [q.host];
    p['h2-opts'] = opts;
  } else if (net === 'http') {
    const opts: Record<string, unknown> = { path: [q.path || '/'] };
    if (q.host) opts.headers = { Host: [q.host] };
    p['http-opts'] = opts;
  } else {
    throw new UnsupportedError(`不支持的传输方式 ${net}`);
  }
}

function parseSS(uri: string): RawProxy {
  // 两种写法：ss://BASE64(method:pass)@host:port#name 与 ss://BASE64(method:pass@host:port)#name
  let body = uri.slice('ss://'.length);
  let name = '';
  const hashAt = body.indexOf('#');
  if (hashAt >= 0) { name = safeDecode(body.slice(hashAt + 1)); body = body.slice(0, hashAt); }
  if (!body.includes('@')) {
    const qAt = body.indexOf('?');
    const head = qAt >= 0 ? body.slice(0, qAt) : body;
    body = decodeBase64(safeDecode(head)) + (qAt >= 0 ? body.slice(qAt) : '');
  }
  const parts = splitUri(`ss://${body}`);
  const info = safeDecode(parts.userinfo ?? '');
  const plain = info.includes(':') ? info : (tryDecodeBase64(info) ?? '');
  const colon = plain.indexOf(':');
  if (colon < 0) throw new Error('ss 缺少加密方式或密码');
  const p: RawProxy = {
    name: name || parts.name,
    type: 'ss',
    server: parts.host,
    port: parts.port,
    cipher: plain.slice(0, colon),
    password: plain.slice(colon + 1),
  };
  const plugin = parts.query.get('plugin');
  if (plugin) {
    const [pname, ...opts] = plugin.split(';');
    const kv = Object.fromEntries(opts.map((o) => { const i = o.indexOf('='); return i < 0 ? [o, 'true'] : [o.slice(0, i), o.slice(i + 1)]; }));
    if (pname === 'obfs-local' || pname === 'simple-obfs') {
      p.plugin = 'obfs';
      p['plugin-opts'] = { mode: kv.obfs ?? 'http', ...(kv['obfs-host'] ? { host: kv['obfs-host'] } : {}) };
    } else if (pname === 'v2ray-plugin') {
      p.plugin = 'v2ray-plugin';
      p['plugin-opts'] = { mode: kv.mode ?? 'websocket', ...(kv.host ? { host: kv.host } : {}), ...(kv.path ? { path: kv.path } : {}), ...(kv.tls !== undefined ? { tls: true } : {}) };
    } else {
      throw new UnsupportedError(`不支持的 ss 插件 ${pname}`);
    }
  }
  if (truthy(parts.query.get('udp-over-tcp'))) p['udp-over-tcp'] = true;
  return p;
}

function parseVmess(uri: string): RawProxy {
  const body = uri.slice('vmess://'.length).split('#')[0]!;
  const decoded = tryDecodeBase64(body);
  if (!decoded) throw new UnsupportedError('仅支持 v2rayN 格式的 vmess 链接');
  const j = JSON.parse(decoded) as Record<string, string | number | undefined>;
  const str = (k: string) => (j[k] === undefined || j[k] === '' ? undefined : String(j[k]));
  const port = Number(j.port);
  if (!str('add') || !(port > 0)) throw new Error('vmess 缺少服务器或端口');
  const p: RawProxy = {
    name: str('ps') ?? `${j.add}:${port}`,
    type: 'vmess',
    server: str('add')!,
    port,
    uuid: str('id') ?? '',
    alterId: Number(j.aid ?? 0),
    cipher: str('scy') ?? 'auto',
  };
  if (str('tls') === 'tls') {
    p.tls = true;
    if (str('sni')) p.servername = str('sni');
    if (str('alpn')) p.alpn = str('alpn')!.split(',');
    if (str('fp')) p['client-fingerprint'] = str('fp');
  }
  applyTransport(p, str('net') ?? null, { path: str('path') ?? null, host: str('host') ?? null });
  return p;
}

function applyTlsQuery(p: RawProxy, q: URLSearchParams, sniField: 'servername' | 'sni'): void {
  const sni = q.get('sni') || q.get('peer');
  if (sni) p[sniField] = sni;
  if (q.get('alpn')) p.alpn = q.get('alpn')!.split(',');
  if (q.get('fp')) p['client-fingerprint'] = q.get('fp');
  if (truthy(q.get('allowInsecure')) || truthy(q.get('insecure')) || truthy(q.get('skip-cert-verify'))) p['skip-cert-verify'] = true;
}

function parseVless(uri: string): RawProxy {
  const u = splitUri(uri);
  const q = u.query;
  const p: RawProxy = { name: u.name, type: 'vless', server: u.host, port: u.port, uuid: safeDecode(u.userinfo ?? '') };
  const security = q.get('security');
  if (security === 'tls' || security === 'reality') {
    p.tls = true;
    applyTlsQuery(p, q, 'servername');
  }
  if (security === 'reality') {
    p['reality-opts'] = { 'public-key': q.get('pbk') ?? '', ...(q.get('sid') ? { 'short-id': q.get('sid') } : {}) };
  }
  if (q.get('flow')) p.flow = q.get('flow');
  applyTransport(p, q.get('type'), { path: q.get('path'), host: q.get('host'), serviceName: q.get('serviceName') });
  return p;
}

function parseTrojan(uri: string): RawProxy {
  const u = splitUri(uri);
  const p: RawProxy = { name: u.name, type: 'trojan', server: u.host, port: u.port, password: safeDecode(u.userinfo ?? '') };
  applyTlsQuery(p, u.query, 'sni');
  applyTransport(p, u.query.get('type'), { path: u.query.get('path'), host: u.query.get('host'), serviceName: u.query.get('serviceName') });
  return p;
}

function parseHysteria2(uri: string): RawProxy {
  const u = splitUri(uri);
  const q = u.query;
  const p: RawProxy = { name: u.name, type: 'hysteria2', server: u.host, port: u.port, password: safeDecode(u.userinfo ?? '') };
  applyTlsQuery(p, q, 'sni');
  if (q.get('obfs')) {
    p.obfs = q.get('obfs');
    if (q.get('obfs-password')) p['obfs-password'] = q.get('obfs-password');
  }
  if (q.get('mport')) p.ports = q.get('mport');
  return p;
}

function parseTuic(uri: string): RawProxy {
  const u = splitUri(uri);
  const q = u.query;
  const info = safeDecode(u.userinfo ?? '');
  const colon = info.indexOf(':');
  const p: RawProxy = { name: u.name, type: 'tuic', server: u.host, port: u.port };
  if (colon >= 0) { p.uuid = info.slice(0, colon); p.password = info.slice(colon + 1); } else { p.token = info; }
  applyTlsQuery(p, q, 'sni');
  if (q.get('congestion_control')) p['congestion-controller'] = q.get('congestion_control');
  if (q.get('udp_relay_mode')) p['udp-relay-mode'] = q.get('udp_relay_mode');
  return p;
}

function parseAnytls(uri: string): RawProxy {
  const u = splitUri(uri);
  const p: RawProxy = { name: u.name, type: 'anytls', server: u.host, port: u.port, password: safeDecode(u.userinfo ?? '') };
  applyTlsQuery(p, u.query, 'sni');
  return p;
}

function parseSocksOrHttp(uri: string): RawProxy {
  const u = splitUri(uri);
  const type = u.scheme.startsWith('socks') ? 'socks5' : 'http';
  const p: RawProxy = { name: u.name, type, server: u.host, port: u.port };
  if (u.userinfo) {
    let info = safeDecode(u.userinfo);
    if (!info.includes(':')) info = tryDecodeBase64(info) ?? info;
    const colon = info.indexOf(':');
    p.username = colon >= 0 ? info.slice(0, colon) : info;
    if (colon >= 0) p.password = info.slice(colon + 1);
  }
  if (u.scheme === 'https' || u.scheme === 'socks5+tls') p.tls = true;
  return p;
}

const PARSERS: Record<string, (uri: string) => RawProxy> = {
  ss: parseSS,
  vmess: parseVmess,
  vless: parseVless,
  trojan: parseTrojan,
  hysteria2: parseHysteria2,
  hy2: parseHysteria2,
  tuic: parseTuic,
  anytls: parseAnytls,
  socks: parseSocksOrHttp,
  socks5: parseSocksOrHttp,
  'socks5+tls': parseSocksOrHttp,
  http: parseSocksOrHttp,
  https: parseSocksOrHttp,
};

export function parseUri(line: string): RawProxy {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(line);
  if (!m) throw new Error('不是 URI');
  const parser = PARSERS[m[1]!.toLowerCase()];
  if (!parser) throw new UnsupportedError(`暂不支持的 URI 协议 ${m[1]}`);
  const p = parser(line);
  if (!p.name) p.name = `${p.server}:${p.port}`;
  return p;
}
