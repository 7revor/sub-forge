import type { FieldGroup, FieldSpec } from '../components/schema.ts';
const field = (key: string, label: string, type: FieldSpec['type'], placeholder: string, options?: string[]): FieldSpec => ({
  key: 'general.' + key, label, type, placeholder, ...(options ? { options } : {}),
});
// 对应 Loon 官方 General 文档，未配置字段保持为空。
export const loonBaseGroups: FieldGroup[] = [
  { title: '网络与局域网', fields: [
    field('ip-mode', 'IP 协议选择', 'enum', '选择 IPv4 与 IPv6 的使用方式', ['v4-only', 'dual', 'prefer-v4', 'prefer-v6', 'v6-only']),
    field('ipv6-vif', '虚拟网卡 IPv6', 'enum', '选择虚拟网卡 IPv6 模式', ['off', 'auto', 'always']),
    field('allow-wifi-access', '允许局域网访问', 'bool', '选择是否允许局域网设备访问'),
    field('wifi-access-http-port', '局域网 HTTP 端口', 'number', '填写 HTTP 代理端口'),
    field('wifi-access-socks5-port', '局域网 SOCKS5 端口', 'number', '填写 SOCKS5 代理端口'),
  ] },
  { title: 'DNS 与域名', fields: [
    field('dns-server', 'DNS 服务器', 'lines', '每行填写一个 DNS 地址，可填写 system'),
    field('doh-server', 'HTTPS DNS', 'lines', '每行填写一个 HTTPS DNS URL'),
    field('doq-server', 'QUIC DNS', 'lines', '每行填写一个 quic:// DNS 地址'),
    field('doh3-server', 'HTTP/3 DNS', 'lines', '每行填写一个 h3:// DNS 地址'),
    field('real-ip', '返回真实 IP 的域名', 'lines', '每行填写一个域名或通配符'),
    field('hijack-dns', '劫持 DNS', 'lines', '每行填写一个地址与端口，如 *:53'),
    { key: 'host', label: '域名映射', type: 'kv', placeholder: '填写域名映射', keyPlaceholder: '填写域名或 SSID', valuePlaceholder: '填写 IP、域名或 server:DNS 地址' },
  ] },
  { title: '流量接管', fields: [
    field('skip-proxy', '绕过 HTTP 代理', 'lines', '每行填写一个域名或 IP 网段'),
    field('bypass-tun', '绕过虚拟网卡', 'lines', '每行填写一个域名或 IP 网段'),
    field('include-tun', '加入虚拟网卡路由', 'lines', '每行填写一个 IPv4 CIDR，需 Build 1007 或更新版本'),
    field('udp-fallback-mode', '不支持 UDP 时的处理', 'enum', '选择拒绝或直连', ['REJECT', 'DIRECT']),
    field('disable-stun', '阻止 STUN', 'bool', '选择是否阻止 STUN 流量'),
  ] },
  { title: '连通性测试', fields: [
    field('proxy-test-url', '代理测速地址', 'string', '填写代理节点测速 URL'),
    field('internet-test-url', '直连测速地址', 'string', '填写直连测速 URL'),
    field('test-timeout', '单次测速超时（秒）', 'number', '填写超时秒数，如 5'),
  ] },
];
