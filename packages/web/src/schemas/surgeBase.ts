import type { FieldGroup, FieldSpec } from '../components/schema.ts';

const field = (key: string, label: string, type: FieldSpec['type'], placeholder: string, options?: string[]): FieldSpec => ({
  key: 'general.' + key, label, type, placeholder, ...(options ? { options } : {}),
});

// 字段含义与单位依据 Surge 官方 General / DNS 文档。
export const surgeBaseGroups: FieldGroup[] = [
  { title: '通用', fields: [
    field('loglevel', '日志级别', 'enum', '选择日志记录级别', ['verbose', 'info', 'notify', 'warning']),
    field('ipv6', '启用 IPv6', 'bool', '选择是否启用 IPv6'),
    field('allow-wifi-access', 'iOS 允许局域网访问', 'bool', '选择是否允许局域网设备访问'),
    field('wifi-access-http-port', 'iOS 局域网 HTTP 端口', 'number', '填写 HTTP 代理端口'),
    field('http-listen', 'Mac HTTP 监听地址', 'lines', '每行填写一个监听地址，如 127.0.0.1:6152'),
    field('socks5-listen', 'Mac SOCKS5 监听地址', 'lines', '每行填写一个监听地址，如 127.0.0.1:6153'),
    field('wifi-access-socks5-port', 'iOS 局域网 SOCKS5 端口', 'number', '填写 SOCKS5 代理端口'),
  ] },
  { title: 'DNS 与域名', fields: [
    field('dns-server', 'DNS 服务器', 'lines', '每行填写一个 DNS 地址，可填写 system'),
    field('encrypted-dns-server', '加密 DNS 服务器', 'lines', '每行填写一个 HTTPS 或 QUIC DNS 地址'),
    field('encrypted-dns-follow-outbound-mode', '加密 DNS 跟随出站模式', 'bool', '选择加密 DNS 是否跟随出站模式'),
    field('always-real-ip', '始终返回真实 IP 的域名', 'lines', '每行填写一个域名或通配符'),
    { key: 'host', label: '域名映射', type: 'kv', placeholder: '填写域名与 IP 映射', keyPlaceholder: '填写域名', valuePlaceholder: '填写 IP 地址或 DNS 参数' },
  ] },
  { title: '流量接管', fields: [
    field('skip-proxy', '绕过 HTTP 代理', 'lines', '每行填写一个域名或 IP 网段'),
    field('tun-included-routes', '加入虚拟网卡路由', 'lines', '每行填写一个 CIDR 网段'),
    field('tun-excluded-routes', '排除虚拟网卡路由', 'lines', '每行填写一个 CIDR 网段'),
    field('hijack-dns', '劫持 DNS', 'lines', '每行填写一个地址与端口，如 8.8.8.8:53'),
  ] },
  { title: '连通性测试', fields: [
    field('proxy-test-url', '代理测速地址', 'string', '填写代理节点测速 URL'),
    field('internet-test-url', '直连测速地址', 'string', '填写直连测速 URL'),
    field('test-timeout', '单次测速超时（秒）', 'number', '填写超时秒数，如 5'),
  ] },
];
