import type { FieldGroup, FieldSpec } from '../components/schema.ts';
const f = (key: string, label: string, type: FieldSpec['type'], placeholder: string, hint?: string): FieldSpec => ({ key, label, type, placeholder, hint });
export const commonBaseGroups: FieldGroup[] = [
  { title: '公共 DNS 与域名', fields: [
    f('dnsServers', '普通 DNS 服务器', 'lines', '每行填写一个 DNS IP 或 system'),
    f('dnsIpv6', '查询 IPv6 地址', 'bool', '选择是否查询 AAAA 记录', '仅控制 DNS；Loon 的连接协议模式需单独配置。'),
    { ...f('hosts', '固定域名地址', 'kv', '填写精确域名与 IP'), keyPlaceholder: '例如：home.example.com', valuePlaceholder: '填写单个 IPv4 或 IPv6 地址' },
    { ...f('dnsPolicy', '按域名指定 DNS', 'kv', '填写精确域名与 DNS'), keyPlaceholder: '填写精确域名', valuePlaceholder: '填写 DNS IP 或 system' },
    f('realIpDomains', '返回真实 IP 的域名', 'lines', '每行填写一个精确域名', '通配符在各端匹配范围不同，请在专用覆盖中维护。'),
    f('geoipUrl', 'GeoIP 数据库地址', 'string', '填写 MMDB 文件的 HTTP(S) 地址', 'Stash 尚未适配此公共项。'),
  ] },
  { title: '监听与测速', fields: [
    f('httpPort', 'HTTP 代理端口', 'number', '填写端口，如 7890'),
    f('socksPort', 'SOCKS5 代理端口', 'number', '填写端口，如 7891'),
    f('allowLan', '允许局域网访问', 'bool', '选择是否开放局域网访问', 'Surge 需明确平台；Loon 映射为 Wi-Fi 代理共享，Stash 需专用配置。'),
    f('testUrl', '默认代理测速地址', 'string', '填写测速 HTTP(S) 地址'),
    f('testTimeoutMs', '默认测速超时（毫秒）', 'number', '例如：3000 表示 3 秒'),
  ] },
];
