import type { LocalProxy } from '@sub-forge/core';
import type { FieldGroup, FieldSpec } from '../components/schema.ts';

export const PROXY_TYPES = [
  { value: 'ss', label: 'Shadowsocks（影梭）' },
  { value: 'vmess', label: 'VMess' }, { value: 'vless', label: 'VLESS' },
  { value: 'trojan', label: 'Trojan' }, { value: 'hysteria2', label: 'Hysteria 2' },
  { value: 'tuic', label: 'TUIC' }, { value: 'anytls', label: 'AnyTLS' },
  { value: 'socks5', label: 'SOCKS5 代理' }, { value: 'http', label: 'HTTP 代理' },
];

const field = (key: string, label: string, type: FieldSpec['type'] = 'string', options?: string[]): FieldSpec => ({ key, label, type, options });
const password = field('password', '密码');
const uuid = field('uuid', 'UUID');
// 常用值来源：https://wiki.metacubex.one/config/proxies/ss/ 和 /tls/。
const fingerprints = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random'];
const auth: Record<string, FieldSpec[]> = {
  ss: [field('cipher', '加密方式', 'enum', ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305']), password,
    field('plugin', '插件'), field('plugin-opts', '插件参数', 'kv')],
  vmess: [uuid, field('alterId', '额外 ID', 'number'), field('cipher', '加密方式', 'enum', ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305'])],
  vless: [uuid, field('flow', '流控', 'enum', ['xtls-rprx-vision'])],
  trojan: [password], anytls: [password],
  hysteria2: [password, field('obfs', '混淆', 'enum', ['salamander']), field('obfs-password', '混淆密码'), field('up', '上传带宽'), field('down', '下载带宽'), field('ports', '跳跃端口')],
  tuic: [uuid, password, field('congestion-controller', '拥塞控制', 'enum', ['cubic', 'new_reno', 'bbr']), field('udp-relay-mode', 'UDP 转发模式', 'enum', ['native', 'quic'])],
  socks5: [field('username', '用户名'), password], http: [field('username', '用户名'), password],
};
const transport: FieldSpec[] = [
  field('network', '传输协议', 'enum', ['tcp', 'ws', 'grpc', 'h2', 'http']),
  ...[field('ws-opts.path', 'WebSocket 路径'), field('ws-opts.headers.Host', 'WebSocket Host')].map((f) => ({ ...f, showIf: (p: Record<string, unknown>) => p.network === 'ws' })),
  { ...field('grpc-opts.grpc-service-name', 'gRPC 服务名称'), showIf: (p) => p.network === 'grpc' },
];

export function schemaFor(type: string): FieldGroup[] {
  const groups: FieldGroup[] = [];
  if (auth[type]) groups.push({ title: '认证', fields: auth[type] });
  if (type !== 'ss' && auth[type]) groups.push({ title: 'TLS', fields: [
    ...(['vmess', 'vless', 'socks5', 'http'].includes(type) ? [field('tls', '启用 TLS', 'bool')] : []),
    field(['vmess', 'vless'].includes(type) ? 'servername' : 'sni', '服务器名称（SNI）'),
    field('skip-cert-verify', '跳过证书验证', 'bool'),
    ...(['vmess', 'vless', 'trojan', 'anytls'].includes(type) ? [field('client-fingerprint', '客户端指纹', 'enum', fingerprints)] : []),
    field('alpn', 'ALPN（每行一项）', 'lines'),
  ] });
  if (type === 'vless') groups.push({ title: 'Reality', fields: [field('reality-opts.public-key', 'Reality 公钥'), field('reality-opts.short-id', 'Reality 短 ID')] });
  if (['vmess', 'vless', 'trojan'].includes(type)) groups.push({ title: '传输', fields: transport });
  groups.push({ title: '通用', fields: [field('udp', 'UDP', 'bool'), field('tfo', 'TCP Fast Open', 'bool'), field('ip-version', 'IP 版本', 'enum', ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'])] });
  return groups;
}

export function defaultsFor(type: string): LocalProxy {
  return { name: '', type, server: '', port: 443,
    ...(type === 'ss' ? { cipher: 'aes-128-gcm' } : {}),
    ...(type === 'vmess' ? { cipher: 'auto', alterId: 0 } : {}),
  };
}
