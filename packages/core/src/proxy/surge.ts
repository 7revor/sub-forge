// Surge [Proxy] 段解析：`Name = type, server, port, key=value, ...`

import type { RawProxy } from './raw.ts';
import { UnsupportedError } from './uri.ts';

/** Surge 内置策略，出现在 [Proxy] 中不是节点，跳过 */
const BUILTIN_TYPES = new Set(['direct', 'reject', 'reject-tinygif', 'reject-drop', 'reject-no-drop']);

/** 按逗号切分，尊重双引号 */
export function splitSurgeParams(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
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
  const positional: string[] = [];
  const kv: Record<string, string> = {};
  for (const item of params.slice(1)) {
    const i = item.indexOf('=');
    if (i < 0) positional.push(item);
    else kv[item.slice(0, i).trim().toLowerCase()] = item.slice(i + 1).trim();
  }
  const server = positional[0];
  const port = Number(positional[1]);
  if (!server || !(port > 0 && port < 65536)) throw new Error('缺少服务器或端口');
  const p: RawProxy = { name, type, server, port };

  const tls = () => {
    if (kv.sni && kv.sni !== 'off') p.sni = kv.sni;
    if (isTrue(kv['skip-cert-verify'])) p['skip-cert-verify'] = true;
  };
  const ws = () => {
    if (!isTrue(kv.ws)) return;
    p.network = 'ws';
    const opts: Record<string, unknown> = { path: kv['ws-path'] || '/' };
    if (kv['ws-headers']) {
      opts.headers = Object.fromEntries(kv['ws-headers'].split('|').map((h) => { const i = h.indexOf(':'); return [h.slice(0, i).trim(), h.slice(i + 1).trim()]; }));
    }
    p['ws-opts'] = opts;
  };

  switch (type) {
    case 'ss':
    case 'shadowsocks':
      p.type = 'ss';
      p.cipher = kv['encrypt-method'] ?? '';
      p.password = kv.password ?? '';
      if (kv.obfs) {
        p.plugin = 'obfs';
        p['plugin-opts'] = { mode: kv.obfs, ...(kv['obfs-host'] ? { host: kv['obfs-host'] } : {}) };
      }
      break;
    case 'vmess':
      p.uuid = kv.username ?? '';
      p.alterId = 0;
      p.cipher = kv['encrypt-method'] ?? 'auto';
      if (isTrue(kv.tls)) { p.tls = true; if (kv.sni) p.servername = kv.sni; if (isTrue(kv['skip-cert-verify'])) p['skip-cert-verify'] = true; }
      ws();
      break;
    case 'trojan':
      p.password = kv.password ?? '';
      tls();
      ws();
      break;
    case 'http':
    case 'https':
    case 'socks5':
    case 'socks5-tls': {
      const user = kv.username ?? positional[2];
      const pass = kv.password ?? positional[3];
      p.type = type.startsWith('socks5') ? 'socks5' : 'http';
      if (user) p.username = user;
      if (pass) p.password = pass;
      if (type === 'https' || type === 'socks5-tls') { p.tls = true; tls(); }
      break;
    }
    case 'snell':
      p.psk = kv.psk ?? '';
      if (kv.version) p.version = Number(kv.version);
      if (kv.obfs) p['obfs-opts'] = { mode: kv.obfs, ...(kv['obfs-host'] ? { host: kv['obfs-host'] } : {}) };
      break;
    case 'hysteria2':
      p.password = kv.password ?? '';
      tls();
      if (kv['download-bandwidth']) p.down = `${kv['download-bandwidth']} Mbps`;
      break;
    case 'tuic':
    case 'tuic-v5':
      p.type = 'tuic';
      if (kv.uuid) p.uuid = kv.uuid;
      if (kv.password) p.password = kv.password;
      if (kv.token) p.token = kv.token;
      if (kv.alpn) p.alpn = kv.alpn.split(',').map((s) => s.trim());
      tls();
      break;
    case 'anytls':
      p.password = kv.password ?? '';
      tls();
      break;
    default:
      throw new UnsupportedError(`暂不支持的 Surge 节点类型 ${type}`);
  }
  if (isTrue(kv['udp-relay'])) p.udp = true;
  if (isTrue(kv.tfo)) p.tfo = true;
  if (kv['underlying-proxy']) p['dialer-proxy'] = kv['underlying-proxy'];
  return p;
}
