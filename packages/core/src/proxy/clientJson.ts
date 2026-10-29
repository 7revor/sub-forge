// 常见客户端的单个出站配置 → mihomo 节点。未知连接字段明确拒绝，避免转换后静默改变连接行为。
import { encodeBase64 } from '../util/base64.ts';
import type { RawProxy } from './raw.ts';
import { parseUri } from './uri.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点配置需要对象');
  return value as ObjectValue;
};
const keys = (value: ObjectValue, allowed: string[], where: string) => {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${where}暂不支持转换字段：${extra.join('、')}，请先转换为 Mihomo 节点配置`);
};
const copy = (from: ObjectValue, to: ObjectValue, mapping: Record<string, string>) => {
  for (const [source, target] of Object.entries(mapping)) if (from[source] !== undefined) to[target] = from[source];
};
const one = (value: unknown, where: string): ObjectValue => {
  if (!Array.isArray(value) || value.length !== 1) throw new Error(`${where}必须只有一项，多个节点或账号请拆分添加`);
  return object(value[0]);
};

function transport(p: RawProxy, value: unknown): void {
  if (value === undefined) return;
  const t = object(value);
  if (t.type === 'ws' || t.type === 'httpupgrade') {
    keys(t, ['type', 'path', 'headers', 'host', 'max_early_data', 'early_data_header_name'], '传输配置');
    p.network = 'ws';
    const opts: ObjectValue = {};
    copy(t, opts, { path: 'path', headers: 'headers', max_early_data: 'max-early-data', early_data_header_name: 'early-data-header-name' });
    if (t.host) opts.headers = { ...(t.headers === undefined ? {} : object(t.headers)), Host: t.host };
    if (t.type === 'httpupgrade') opts['v2ray-http-upgrade'] = true;
    p['ws-opts'] = opts;
  } else if (t.type === 'grpc') {
    keys(t, ['type', 'service_name'], 'gRPC');
    p.network = 'grpc';
    p['grpc-opts'] = { 'grpc-service-name': t.service_name ?? '' };
  } else {
    throw new Error(`暂不支持转换传输方式 ${String(t.type)}，请先转换为 Mihomo 节点配置`);
  }
}

function tls(p: RawProxy, value: unknown): void {
  if (value === undefined) return;
  const t = object(value);
  keys(t, ['enabled', 'server_name', 'insecure', 'alpn', 'utls', 'reality'], 'TLS');
  if (typeof t.enabled !== 'boolean') throw new Error('TLS enabled 必须为布尔值');
  if (!t.enabled && ['trojan', 'hysteria2', 'tuic', 'anytls'].includes(p.type)) throw new Error(`Mihomo 的 ${p.type} 节点不能关闭 TLS，无法保持原配置行为`);
  p.tls = t.enabled;
  const sni = ['vless', 'vmess'].includes(p.type) ? 'servername' : 'sni';
  copy(t, p, { server_name: sni, insecure: 'skip-cert-verify', alpn: 'alpn' });
  if (t.utls !== undefined) {
    const u = object(t.utls);
    keys(u, ['enabled', 'fingerprint'], 'uTLS');
    if (u.enabled === true) p['client-fingerprint'] = u.fingerprint ?? 'chrome';
  }
  if (t.reality !== undefined) {
    const r = object(t.reality);
    keys(r, ['enabled', 'public_key', 'short_id'], 'Reality');
    if (r.enabled === true) {
      if (t.enabled !== true || typeof r.public_key !== 'string' || !r.public_key) throw new Error('Reality 需要启用 TLS 并填写公钥');
      const opts: ObjectValue = {};
      copy(r, opts, { public_key: 'public-key', short_id: 'short-id' });
      p['reality-opts'] = opts;
    }
  }
}

function singBox(o: ObjectValue): RawProxy {
  const types: Record<string, string> = { shadowsocks: 'ss', vmess: 'vmess', vless: 'vless', trojan: 'trojan', hysteria2: 'hysteria2', tuic: 'tuic', anytls: 'anytls', socks: 'socks5', http: 'http' };
  const type = Object.hasOwn(types, String(o.type)) ? types[String(o.type)] : undefined;
  if (!type) throw new Error(`暂不支持转换 sing-box 节点类型 ${String(o.type)}`);
  keys(o, ['type', 'tag', 'server', 'server_port', 'uuid', 'password', 'username', 'method', 'security', 'alter_id', 'flow', 'network', 'tls', 'transport', 'detour', 'version', 'congestion_control', 'udp_relay_mode', 'obfs'], 'sing-box');
  if (o.network !== undefined && o.network !== 'tcp') throw new Error(`暂不支持转换 sing-box network=${String(o.network)}`);
  if (o.version !== undefined && o.version !== '5' && o.version !== 5) throw new Error('仅支持 SOCKS5');
  const p: RawProxy = { name: String(o.tag ?? `${o.server}:${o.server_port}`), type, server: o.server as string, port: Number(o.server_port) };
  copy(o, p, { uuid: 'uuid', password: 'password', username: 'username', method: 'cipher', security: 'cipher', alter_id: 'alterId', flow: 'flow', detour: 'dialer-proxy', congestion_control: 'congestion-controller', udp_relay_mode: 'udp-relay-mode' });
  if (type === 'vmess') { p.alterId ??= 0; p.cipher ??= 'auto'; }
  p.udp = o.network !== 'tcp';
  if (o.obfs !== undefined) {
    const obfs = object(o.obfs);
    keys(obfs, ['type', 'password'], '混淆');
    p.obfs = obfs.type; p['obfs-password'] = obfs.password;
  }
  tls(p, o.tls);
  transport(p, o.transport);
  return p;
}

function xray(o: ObjectValue): RawProxy {
  keys(o, ['tag', 'protocol', 'settings', 'streamSettings'], 'Xray / V2Ray');
  const protocol = String(o.protocol);
  if (!['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http'].includes(protocol)) throw new Error(`暂不支持转换 Xray / V2Ray 协议 ${protocol}`);
  const settings = object(o.settings);
  let endpoint = settings;
  let auth = settings;
  if ('vnext' in settings) {
    keys(settings, ['vnext'], '节点设置');
    endpoint = one(settings.vnext, 'vnext');
    keys(endpoint, ['address', 'port', 'users'], '服务器');
    auth = one(endpoint.users, 'users');
  } else if ('servers' in settings) {
    keys(settings, ['servers'], '节点设置');
    endpoint = one(settings.servers, 'servers');
    keys(endpoint, ['address', 'port', 'password', 'method', 'users'], '服务器');
    auth = endpoint.users === undefined ? endpoint : one(endpoint.users, 'users');
  }
  keys(auth, ['address', 'port', 'id', 'alterId', 'security', 'encryption', 'flow', 'password', 'method', 'user', 'pass', 'email', 'level'], '节点认证');
  if (auth.encryption !== undefined && auth.encryption !== 'none') throw new Error('暂不支持转换 VLESS encryption，请先转换为 Mihomo 配置');
  const type = protocol === 'shadowsocks' ? 'ss' : protocol === 'socks' ? 'socks5' : protocol;
  const p: RawProxy = { name: String(o.tag ?? `${endpoint.address}:${endpoint.port}`), type, server: endpoint.address as string, port: Number(endpoint.port) };
  copy(auth, p, { id: 'uuid', alterId: 'alterId', security: 'cipher', flow: 'flow', password: 'password', method: 'cipher', user: 'username', pass: 'password' });
  if (type === 'vmess') { p.alterId ??= 0; p.cipher ??= 'auto'; }
  if (o.streamSettings !== undefined) {
    const s = object(o.streamSettings);
    keys(s, ['network', 'method', 'security', 'tlsSettings', 'realitySettings', 'wsSettings', 'grpcSettings', 'httpupgradeSettings'], '传输配置');
    const security = s.security ?? 'none';
    if (!['none', 'tls', 'reality'].includes(String(security))) throw new Error(`暂不支持转换传输安全 ${String(security)}`);
    if (type === 'trojan' && security === 'none') throw new Error('Mihomo 的 trojan 节点不能关闭 TLS，无法保持原配置行为');
    if (security !== 'none') {
      const t = object((security === 'reality' ? s.realitySettings : s.tlsSettings) ?? {});
      keys(t, ['serverName', 'allowInsecure', 'alpn', 'fingerprint', 'publicKey', 'password', 'shortId'], 'TLS / Reality');
      tls(p, { enabled: true, server_name: t.serverName, insecure: t.allowInsecure, alpn: t.alpn,
        ...(t.fingerprint ? { utls: { enabled: true, fingerprint: t.fingerprint } } : {}),
        ...(security === 'reality' ? { reality: { enabled: true, public_key: t.publicKey ?? t.password, short_id: t.shortId } } : {}) });
    }
    const network = s.network ?? s.method ?? 'tcp';
    if (network === 'ws' || network === 'websocket') transport(p, { ...object(s.wsSettings ?? {}), type: 'ws' });
    else if (network === 'httpupgrade') transport(p, { ...object(s.httpupgradeSettings ?? {}), type: 'httpupgrade' });
    else if (network === 'grpc') {
      const g = object(s.grpcSettings ?? {});
      keys(g, ['serviceName'], 'gRPC');
      transport(p, { type: 'grpc', service_name: g.serviceName });
    } else if (network !== 'tcp' && network !== 'raw') throw new Error(`暂不支持转换传输方式 ${String(network)}`);
  }
  return p;
}

/** 返回 undefined 表示不是已知客户端对象，让调用方继续按原生 Mihomo 配置处理。 */
export function parseClientProxyObject(value: unknown): RawProxy | undefined {
  const o = object(value);
  if ('protocol' in o) return xray(o);
  if ('server_port' in o) return singBox(o);
  if ('add' in o && 'id' in o) {
    keys(o, ['v', 'ps', 'add', 'port', 'id', 'aid', 'scy', 'net', 'type', 'host', 'path', 'tls', 'sni', 'alpn', 'fp'], 'VMess 分享 JSON');
    if (o.type !== undefined && o.type !== 'none' && o.type !== '') throw new Error('暂不支持转换 VMess 伪装类型');
    return parseUri(`vmess://${encodeBase64(JSON.stringify(o))}`);
  }
  return undefined;
}
