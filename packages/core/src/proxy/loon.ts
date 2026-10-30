import { splitRuleFields } from '../rules/syntax.ts';
import type { RawProxy } from './raw.ts';
import { UnsupportedError } from './uri.ts';

const decode = (value: string): string => {
  if (value.startsWith('"')) {
    try { const parsed: unknown = JSON.parse(value); if (typeof parsed === 'string') return parsed; }
    catch { throw new Error('节点参数引号格式错误'); }
    throw new Error('节点参数必须是文本');
  }
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
};

/** 与 Surge 共用 [Proxy] 段，按节点位置参数与 Loon 特有选项判别。 */
export function isLoonLine(line: string): boolean {
  const parts = splitRuleFields(line.slice(line.indexOf('=') + 1), false);
  const type = parts[0]?.toLowerCase();
  if (type === 'vless' || type === 'shadowsocksr') return true;
  if (['shadowsocks', 'ss', 'vmess', 'trojan', 'anytls', 'hysteria2'].includes(type ?? '') && parts[3] && (parts[3].startsWith('"') || !parts[3].includes('='))) return true;
  return parts.some(p => /^(over-tls|fast-open|transport|ip-mode|tls-name|tls-profile|tls-cert-sha256|server-ports|obfs-name)=/.test(p));
}

export function parseLoonLine(line: string): RawProxy {
  const eq = line.indexOf('=');
  if (eq < 1) throw new Error('不是 Loon 节点行');
  const parts = splitRuleFields(line.slice(eq + 1), false);
  const type = parts[0]!.toLowerCase();
  const port = Number(parts[2]), server = decode(parts[1] ?? '');
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('缺少服务器或端口');
  const p: RawProxy = { name: line.slice(0, eq).trim(), type, server, port };
  let offset = 3;
  const position = (key: string) => {
    const field = parts[offset++];
    if (field === undefined) throw new Error('Loon 节点缺少 ' + key);
    p[key] = decode(field);
  };
  switch (type) {
    case 'ss': case 'shadowsocks': case 'shadowsocksr':
      p.type = type === 'shadowsocksr' ? 'ssr' : 'ss'; position('cipher'); position('password'); break;
    case 'vmess': position('cipher'); position('uuid'); break;
    case 'vless': position('uuid'); break;
    case 'trojan': case 'hysteria2': case 'anytls': position('password'); break;
    case 'http': case 'https': case 'socks5':
      if (type === 'https') { p.type = 'http'; p.tls = true; }
      if (parts[offset] !== undefined && (parts[offset]!.startsWith('"') || !parts[offset]!.includes('='))) { position('username'); position('password'); }
      break;
    default: throw new UnsupportedError('暂不支持的 Loon 节点类型 ' + type);
  }
  const kv: Record<string, string> = Object.create(null);
  for (const part of parts.slice(offset)) {
    const i = part.indexOf('=');
    if (i < 1) throw new Error('Loon 节点选项需要 字段=值');
    const key = part.slice(0, i).trim().toLowerCase();
    if (Object.hasOwn(kv, key)) throw new Error('Loon 节点参数重复：' + key);
    kv[key] = decode(part.slice(i + 1).trim());
  }
  const take = (key: string): string | undefined => { const value = kv[key]; delete kv[key]; return value; };
  const move = (key: string, target = key) => { const v = take(key); if (v !== undefined) p[target] = v; };
  for (const [source, target] of [['over-tls', 'tls'], ['skip-cert-verify', 'skip-cert-verify'], ['fast-open', 'tfo'], ['tfo', 'tfo'], ['udp', 'udp'], ['block-quic', 'block-quic'], ['udp-over-tcp', 'udp-over-tcp'], ['always-use-connect', 'always-use-connect']]) {
    const v = take(source!);
    if (v !== undefined) {
      if (!['true', 'false'].includes(v)) throw new Error(source + ' 必须为布尔值');
      p[target!] = v === 'true';
    }
  }
  for (const key of ['alterid', 'hop-interval', 'idle-session-timeout', 'max-stream-count', 'udp-port']) {
    const v = take(key);
    if (v !== undefined) { if (!/^\d+(?:\.\d+)?$/.test(v)) throw new Error(key + ' 必须为数字'); p[key === 'alterid' ? 'alterId' : key] = Number(v); }
  }
  if (type === 'vmess') p.alterId ??= 0;
  for (const key of ['flow', 'protocol', 'protocol-param', 'obfs', 'obfs-param']) move(key);
  move('sni'); const tlsName = take('tls-name');
  if (tlsName !== undefined) { if (p.sni !== undefined && p.sni !== tlsName) throw new Error('sni 与 tls-name 不一致'); p.sni = tlsName; }
  move('tls-cert-sha256', 'fingerprint'); move('tls-pubkey-sha256');
  move('underlying-proxy', 'dialer-proxy');
  const tlsProfile = take('tls-profile');
  if (tlsProfile) {
    const fingerprint = { chrome: 'chrome', 'safari-ios18': 'safari', default: undefined, global: undefined }[tlsProfile];
    if (!['chrome', 'safari-ios18', 'default', 'global'].includes(tlsProfile)) throw new UnsupportedError('暂不支持此 Loon TLS 指纹配置');
    if (fingerprint) p['client-fingerprint'] = fingerprint;
  }
  for (const key of ['alpn', 'server-dns']) { const v = take(key); if (v !== undefined) p[key] = v.split(',').map(s => s.trim()); }
  const mode = take('ip-mode');
  if (mode !== undefined) {
    const mapping = { 'v4-only': 'ipv4', 'v6-only': 'ipv6', dual: 'dual', 'prefer-v4': 'ipv4-prefer', 'prefer-v6': 'ipv6-prefer' }[mode];
    if (!mapping) throw new Error('Loon IP 模式不合法');
    p['ip-version'] = mapping;
  }
  const transport = take('transport'), path = take('path'), host = take('host');
  if (transport !== undefined) {
    if (!['tcp', 'ws', 'http'].includes(transport) || (type === 'trojan' && transport === 'http')) throw new UnsupportedError('暂不支持此 Loon 传输方式');
    if (transport !== 'tcp') {
      p.network = transport;
      p[transport === 'ws' ? 'ws-opts' : 'http-opts'] = { ...(path !== undefined ? { path: transport === 'http' ? [path] : path } : {}), ...(host !== undefined ? { headers: { Host: transport === 'http' ? [host] : host } } : {}) };
    } else if (path !== undefined || host !== undefined) throw new Error('TCP 传输不能保留 Host 或 path');
  } else if (path !== undefined || host !== undefined) throw new Error('Host 或 path 缺少对应的 transport');
  const publicKey = take('public-key'), shortId = take('short-id');
  if (publicKey !== undefined) p['reality-opts'] = { 'public-key': publicKey, ...(shortId !== undefined ? { 'short-id': shortId } : {}) };
  else if (shortId !== undefined) throw new Error('Reality 缺少公钥');
  const obfsName = take('obfs-name'), obfsHost = take('obfs-host'), obfsUri = take('obfs-uri');
  if (obfsName && obfsName !== 'none') { p.plugin = 'obfs'; p['plugin-opts'] = { mode: obfsName, ...(obfsHost !== undefined ? { host: obfsHost } : {}), ...(obfsUri !== undefined ? { uri: obfsUri } : {}) }; }
  else if (obfsHost !== undefined || obfsUri !== undefined) throw new Error('混淆参数缺少 obfs-name');
  const shadowPassword = take('shadow-tls-password');
  if (shadowPassword !== undefined) {
    if (p.plugin) throw new Error('ShadowTLS 与 Simple Obfs 不能混用');
    p.plugin = 'shadow-tls';
    const host = take('shadow-tls-sni'), version = take('shadow-tls-version');
    p['plugin-opts'] = { password: shadowPassword, ...(host ? { host } : {}), ...(version ? { version: Number(version) } : {}) };
  }
  const salamander = take('salamander-password');
  if (salamander !== undefined) { p.obfs = 'salamander'; p['obfs-password'] = salamander; }
  const ports = take('server-ports'); if (ports !== undefined) p.ports = ports.replace(/:/g, '-');
  const download = take('download-bandwidth'); if (download !== undefined) p.down = download + ' Mbps';
  if (Object.keys(kv).length) throw new UnsupportedError('暂不支持的 Loon 节点参数：' + Object.keys(kv).join('、'));
  return p;
}
