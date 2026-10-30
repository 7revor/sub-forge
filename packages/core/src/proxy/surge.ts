// Surge [Proxy] 段解析：`Name = type, server, port, key=value, ...`

import type { RawProxy } from './raw.ts';
import { UnsupportedError } from './uri.ts';
import { splitRuleFields } from '../rules/syntax.ts';
import { stripIniComment } from '../render/ini-format.ts';

/** Surge 内置策略，出现在 [Proxy] 中不是节点，跳过 */
const BUILTIN_TYPES = new Set(['direct', 'reject', 'reject-tinygif', 'reject-drop', 'reject-no-drop']);

/** 按逗号切分，尊重双引号 */
export function splitSurgeParams(s: string): string[] {
  return splitRuleFields(stripIniComment(s), false);
}

function decode(value: string): string {
  if (!value.startsWith('"')) return value.trim();
  const decoded: unknown = JSON.parse(value);
  if (typeof decoded !== 'string') throw new Error('Surge 节点参数必须为文本');
  return decoded;
}

const isTrue = (v: string | undefined) => v === 'true' || v === '1';

/** 返回 undefined 表示该行是内置策略而非节点 */
export function parseSurgeLine(line: string): RawProxy | undefined {
  const eq = line.indexOf('=');
  if (eq < 0) throw new Error('不是 Surge 节点行');
  const name = line.slice(0, eq).trim();
  const params = splitSurgeParams(line.slice(eq + 1));
  const type = (params[0] ?? '').toLowerCase();
  if (BUILTIN_TYPES.has(type)) return undefined;
  const positional: string[] = params.slice(1, 3).map(decode);
  const kv: Record<string, string> = Object.create(null);
  // 前两个参数始终是服务器、端口；后续仅 HTTP/SOCKS 允许位置凭据。
  for (const item of params.slice(3)) {
    const i = item.indexOf('=');
    if (i < 0 || item.startsWith('"')) positional.push(decode(item));
    else {
      const key = item.slice(0, i).trim().toLowerCase();
      if (Object.hasOwn(kv, key)) throw new Error('Surge 节点参数重复：' + key);
      kv[key] = decode(item.slice(i + 1).trim());
    }
  }
  const server = positional[0];
  const port = Number(positional[1]);
  if (!server || !Number.isInteger(port) || !(port > 0 && port < 65536)) throw new Error('缺少服务器或端口');
  const p: RawProxy = { name, type, server, port };
  const allowed = new Set(['udp-relay', 'tfo', 'underlying-proxy', 'interface', 'test-url', 'test-timeout', 'block-quic', 'ip-version', 'server-cert-fingerprint-sha256', 'sni', 'skip-cert-verify', 'alpn']);
  const allow = (...keys: string[]) => keys.forEach(k => allowed.add(k));
  const boolean = (source: string, target = source) => {
    if (kv[source] === undefined) return;
    if (!['true', 'false', '0', '1'].includes(kv[source]!)) throw new Error(source + ' 必须为布尔值');
    p[target] = isTrue(kv[source]);
  };

  const tls = () => {
    if (kv.sni === 'off') throw new UnsupportedError('暂不支持关闭 Surge SNI');
    if (kv.sni !== undefined) p.sni = kv.sni;
    boolean('skip-cert-verify');
  };
  const ws = () => {
    if (kv.ws !== undefined && !['true', 'false', '0', '1'].includes(kv.ws)) throw new Error('ws 必须为布尔值');
    if (!isTrue(kv.ws) && (kv['ws-path'] !== undefined || kv['ws-headers'] !== undefined)) throw new Error('WebSocket 参数需要 ws=true');
    if (!isTrue(kv.ws)) return;
    p.network = 'ws';
    const opts: Record<string, unknown> = { path: kv['ws-path'] || '/' };
    if (kv['ws-headers']) {
      opts.headers = Object.fromEntries(kv['ws-headers'].split('|').map((h) => { const i = h.indexOf(':'); if (i < 1) throw new Error('WebSocket 请求头缺少冒号'); return [h.slice(0, i).trim(), h.slice(i + 1).trim()]; }));
    }
    p['ws-opts'] = opts;
  };

  tls();
  switch (type) {
    case 'ss':
    case 'shadowsocks':
      allow('encrypt-method', 'password', 'obfs', 'obfs-host', 'obfs-uri');
      p.type = 'ss';
      p.cipher = kv['encrypt-method'] ?? '';
      p.password = kv.password ?? '';
      if (kv.obfs) {
        p.plugin = 'obfs';
        p['plugin-opts'] = { mode: kv.obfs, ...(kv['obfs-host'] ? { host: kv['obfs-host'] } : {}), ...(kv['obfs-uri'] !== undefined ? { uri: kv['obfs-uri'] } : {}) };
      }
      break;
    case 'vmess':
      allow('username', 'encrypt-method', 'tls', 'vmess-aead', 'ws', 'ws-path', 'ws-headers');
      if (!isTrue(kv['vmess-aead'])) throw new UnsupportedError('仅支持显式 vmess-aead=true 的 Surge VMess 节点');
      p.uuid = kv.username ?? '';
      p.alterId = 0;
      p.cipher = kv['encrypt-method'] === 'chacha20-ietf-poly1305' ? 'chacha20-poly1305' : kv['encrypt-method'] ?? 'auto';
      boolean('tls');
      if (kv.sni) p.servername = kv.sni;
      delete p.sni;
      boolean('skip-cert-verify');
      ws();
      break;
    case 'trojan':
      allow('password', 'ws', 'ws-path', 'ws-headers');
      p.password = kv.password ?? '';
      tls();
      ws();
      break;
    case 'http':
    case 'https':
    case 'socks5':
    case 'socks5-tls': {
      allow('username', 'password');
      const user = kv.username ?? positional[2];
      const pass = kv.password ?? positional[3];
      p.type = type.startsWith('socks5') ? 'socks5' : 'http';
      if (user) p.username = user;
      if (pass) p.password = pass;
      if (type === 'https' || type === 'socks5-tls') { p.tls = true; tls(); }
      break;
    }
    case 'snell':
      allow('psk', 'version', 'obfs', 'obfs-host');
      p.psk = kv.psk ?? '';
      if (kv.version) p.version = Number(kv.version);
      if (kv.obfs) p['obfs-opts'] = { mode: kv.obfs, ...(kv['obfs-host'] ? { host: kv['obfs-host'] } : {}) };
      break;
    case 'hysteria2':
      allow('password', 'download-bandwidth', 'salamander-password', 'port-hopping', 'port-hopping-interval', 'ecn');
      p.password = kv.password ?? '';
      tls();
      if (kv['download-bandwidth']) p.down = `${kv['download-bandwidth']} Mbps`;
      if (kv['salamander-password'] !== undefined) { p.obfs = 'salamander'; p['obfs-password'] = kv['salamander-password']; }
      break;
    case 'tuic':
    case 'tuic-v5':
      allow('uuid', 'password', 'token', 'port-hopping', 'port-hopping-interval', 'ecn');
      p.type = 'tuic';
      if (kv.uuid) p.uuid = kv.uuid;
      if (kv.password) p.password = kv.password;
      if (kv.token) p.token = kv.token;
      if (kv.alpn) p.alpn = kv.alpn.split(',').map((s) => s.trim());
      tls();
      break;
    case 'anytls':
      allow('password');
      p.password = kv.password ?? '';
      tls();
      break;
    default:
      throw new UnsupportedError(`暂不支持的 Surge 节点类型 ${type}`);
  }
  boolean('udp-relay', 'udp'); boolean('tfo');
  if (kv['block-quic'] !== undefined) {
    const block = kv['block-quic'];
    if (!['on', 'off', 'auto', 'adaptive', 'true', 'false'].includes(block)) throw new Error('block-quic 必须为 on、off、auto 或 adaptive');
    p['block-quic'] = block === 'true' ? 'on' : block === 'false' ? 'off' : block;
  }
  if (allowed.has('ecn')) boolean('ecn');
  if (kv.alpn !== undefined) p.alpn = kv.alpn.split(',').map(s => s.trim());
  if (kv['port-hopping'] !== undefined) p.ports = kv['port-hopping'].replace(/;/g, ',');
  for (const [key, target] of [['port-hopping-interval', 'hop-interval'], ['test-timeout', 'test-timeout']] as const) {
    if (kv[key] !== undefined) { if (!/^\d+(?:\.\d+)?$/.test(kv[key]!)) throw new Error(key + ' 必须为数字'); p[target] = Number(kv[key]); }
  }
  for (const [key, target] of [['interface', 'interface-name'], ['test-url', 'test-url'], ['server-cert-fingerprint-sha256', 'fingerprint']] as const) if (kv[key] !== undefined) p[target] = kv[key];
  if (kv['ip-version'] !== undefined) {
    const mapping = { dual: 'dual', 'v4-only': 'ipv4', 'v6-only': 'ipv6', 'prefer-v4': 'ipv4-prefer', 'prefer-v6': 'ipv6-prefer' }[kv['ip-version']!];
    if (!mapping) throw new Error('Surge IP 模式不合法');
    p['ip-version'] = mapping;
  }
  if (kv['underlying-proxy']) p['dialer-proxy'] = kv['underlying-proxy'];
  const unknown = Object.keys(kv).filter(k => !allowed.has(k));
  if (unknown.length) throw new UnsupportedError('暂不支持的 Surge 节点参数：' + unknown.join('、'));
  if (positional.length > (['http', 'https', 'socks5', 'socks5-tls'].includes(type) ? 4 : 2)) throw new Error('多余的 Surge 节点位置参数');
  return p;
}
