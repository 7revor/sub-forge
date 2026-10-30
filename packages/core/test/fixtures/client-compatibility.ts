import { stringify as testYaml } from 'yaml';
// 以 Mihomo 字段为输入，逐项测试目标输出；ok 仅表示生成器完整接受，不代表真机连接通过。
import type { Client, GroupSpec, LocalProxy, RenderInput } from '../../src/index.ts';
import { parseRuleLine, renderMihomo, renderSurge, renderLoon, renderStash, type MihomoRenderResult } from '../../src/index.ts';
import { iniFixture, routing } from './ini-client.ts';
export const targets = ['mihomo', 'surge', 'loon', 'stash'] as const;
export type Status = 'ok' | 'error' | 'omitted' | 'warning';
export const renderers = { mihomo: renderMihomo, surge: renderSurge, loon: renderLoon, stash: renderStash };
export function outputStatus(result: MihomoRenderResult): Status {
  if (result.report.hasErrors) return 'error';
  if (result.report.items.some(item => item.code === 'rule.dropped' || item.code === 'rule.client')) return 'omitted';
  return result.report.items.some(item => item.level === 'warn') ? 'warning' : 'ok';
}
export type CompatibilityCase = { id: string; category: string; label: string; apply: (f: RenderInput) => void; expected?: Partial<Record<Client, Status>>; caveat?: string };
export function commonInput(): RenderInput {
  const f = iniFixture(); f.base = ''; f.platform = 'ios'; f.profile.nodeSets[0]!.output = 'inline';
  f.nodeSets.locals.nodes!.proxies = [{ name: '测试节点', type: 'trojan', server: 'node.example.test', port: 443, password: 'example' }];
  routing(f).rules = []; return f;
}
const uuid = '0233d11c-15a4-47d3-ade3-48ffca0ce119';
const node = (id: string, label: string, fields: Omit<LocalProxy, 'name' | 'server' | 'port'>, expected?: CompatibilityCase['expected'], caveat?: string): CompatibilityCase => ({ id, label, category: '节点', expected, caveat, apply: f => { f.nodeSets.locals.nodes!.proxies = [{ name: '测试节点', server: 'node.example.test', port: 443, type: String(fields.type), ...fields }]; } });
const trojan = { type: 'trojan', password: 'example' };
const vmess = { type: 'vmess', uuid, alterId: 0, cipher: 'auto', tls: true };
const ss = { type: 'ss', cipher: 'aes-128-gcm', password: 'example' };
const hy2 = { type: 'hysteria2', password: 'example' };
const group = (id: string, label: string, fields: Partial<GroupSpec>, expected?: CompatibilityCase['expected'], caveat?: string): CompatibilityCase => ({ id, label, category: '策略组', expected, caveat, apply: f => Object.assign(routing(f).groups[0]!, fields) });
const rule = (id: string, label: string, line: string, expected?: CompatibilityCase['expected'], caveat?: string): CompatibilityCase => ({ id, label, category: '规则', expected, caveat, apply: f => { routing(f).rules = [{ id, matcher: { kind: 'rule', rule: parseRuleLine(line) }, target: { kind: 'group', groupId: 'all' } }]; } });
export const compatibilityCases: CompatibilityCase[] = [
  node('ss-aes128', 'SS aes-128-gcm', ss),
  node('ss-aes256', 'SS aes-256-gcm', { ...ss, cipher: 'aes-256-gcm' }),
  node('ss-chacha', 'SS chacha20-ietf-poly1305', { ...ss, cipher: 'chacha20-ietf-poly1305' }),
  node('ss-obfs', 'SS simple-obfs（http/Host）', { ...ss, plugin: 'obfs', 'plugin-opts': { mode: 'http', host: 'cdn.example.test' } }),
  node('ss-shadowtls', 'SS ShadowTLS', { ...ss, plugin: 'shadow-tls', 'plugin-opts': { host: 'cdn.example.test', password: 'example', version: 3 } }, { surge: 'error' }),
  node('ss-v2ray', 'SS v2ray-plugin', { ...ss, plugin: 'v2ray-plugin', 'plugin-opts': { mode: 'websocket', host: 'cdn.example.test' } }, { surge: 'error', loon: 'error' }),
  node('vmess-tcp', 'VMess AEAD TCP/TLS', vmess),
  node('vmess-ws', 'VMess AEAD WS/TLS + 单个 Host/path', { ...vmess, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } } }),
  node('vmess-header', 'VMess WS 自定义 X-Test 请求头', { ...vmess, network: 'ws', 'ws-opts': { path: '/ws', headers: { 'X-Test': 'example' } } }, { loon: 'error' }),
  node('vmess-alterid', 'VMess alterId=64', { ...vmess, alterId: 64 }, { surge: 'error' }),
  node('vmess-none', 'VMess cipher=none', { ...vmess, cipher: 'none' }, { surge: 'error' }),
  node('vmess-grpc', 'VMess gRPC', { ...vmess, network: 'grpc', 'grpc-opts': { 'grpc-service-name': 'example' } }, { surge: 'error', loon: 'error' }),
  node('trojan-tcp', 'Trojan TCP/TLS', trojan),
  node('trojan-tls', 'Trojan SNI、证书校验、ALPN', { ...trojan, sni: 'tls.example.test', 'skip-cert-verify': false, alpn: ['h2', 'http/1.1'] }),
  node('trojan-udp', 'Trojan 显式 udp=true、tfo=false', { ...trojan, udp: true, tfo: false }, undefined, 'Stash 的 tfo 仅透传、官方未确认；各端 QUIC/UDP 默认行为不同，不能宣称等价'),
  node('trojan-ws', 'Trojan WebSocket', { ...trojan, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } } }, { surge: 'error' }),
  node('http', 'HTTP 认证', { type: 'http', username: 'example', password: 'example' }),
  node('https', 'HTTPS 认证与 SNI', { type: 'http', username: 'example', password: 'example', tls: true, sni: 'tls.example.test' }),
  node('socks', 'SOCKS5 认证', { type: 'socks5', username: 'example', password: 'example' }),
  node('socks-tls', 'SOCKS5 TLS', { type: 'socks5', username: 'example', password: 'example', tls: true }),
  node('anytls', 'AnyTLS 基础认证/SNI', { type: 'anytls', password: 'example', sni: 'tls.example.test' }),
  node('hy2', 'Hysteria2 基础认证/SNI', { ...hy2, sni: 'tls.example.test' }),
  node('hy2-down', 'Hysteria2 下行 100 Mbps', { ...hy2, down: '100 Mbps' }),
  node('hy2-obfs', 'Hysteria2 Salamander', { ...hy2, obfs: 'salamander', 'obfs-password': 'example-obfs' }),
  node('hy2-ports', 'Hysteria2 端口跳跃', { ...hy2, ports: '20000-20100,30000', 'hop-interval': 30 }, undefined, '端口和秒单位已核对官方格式；未验证真实转发'),
  node('hy2-up', 'Hysteria2 上行限制', { ...hy2, up: '50 Mbps' }, { surge: 'warning', loon: 'warning' }),
  node('vless', 'VLESS TLS', { type: 'vless', uuid, tls: true }, { surge: 'error' }),
  node('vless-reality', 'VLESS Reality/Vision', { type: 'vless', uuid, tls: true, flow: 'xtls-rprx-vision', 'reality-opts': { 'public-key': 'B6r_Pp_BZydVRPTDpqF82Dfy7G54zYpXsePfs8wDWnY', 'short-id': 'abcdef' } }, { surge: 'error' }),
  node('tuic', 'TUIC v5', { type: 'tuic', uuid, password: 'example' }, { loon: 'error' }),
  node('snell', 'Snell v3', { type: 'snell', psk: 'example', version: 3 }, { loon: 'error' }),
  node('ssr', 'ShadowsocksR', { type: 'ssr', password: 'example', cipher: 'aes-128-cfb', protocol: 'auth_aes128_md5', obfs: 'tls1.2_ticket_auth' }, { surge: 'error' }),
  node('fingerprint', 'client-fingerprint=chrome', { ...trojan, 'client-fingerprint': 'chrome' }, { surge: 'warning' }, 'Loon 映射有说明；不承诺握手字节一致'),
  node('ip-version', '节点 ip-version=ipv4', { ...trojan, 'ip-version': 'ipv4' }, { stash: 'error' }),
  node('smux', '节点 smux', { ...trojan, smux: { enabled: true } }, { surge: 'error', loon: 'error', stash: 'error' }),
  group('select', 'select 与节点成员', { type: 'select' }),
  group('nested', '嵌套策略组', { type: 'select' }),
  group('url-test', 'url-test + url/interval/timeout/tolerance', { type: 'url-test', test: { url: 'http://example.test/204', interval: 300, timeout: 5000, tolerance: 50 } }, undefined, '多组共享节点需统一测速参数，Loon 超时全局统一；选择结果可能不同'),
  group('fallback', 'fallback + url/interval/timeout', { type: 'fallback', test: { url: 'http://example.test/204', interval: 300, timeout: 5000 } }, undefined, '跨端测速和可用性判定存在差异'),
  group('balance-hash', 'load-balance consistent-hashing', { type: 'load-balance', strategy: 'consistent-hashing' }, undefined, '只保留按目标主机稳定选节点的意图，哈希算法不保证相同'),
  group('balance-round', 'load-balance round-robin', { type: 'load-balance', strategy: 'round-robin' }, { surge: 'error' }),
  group('balance-sticky', 'load-balance sticky-sessions', { type: 'load-balance', strategy: 'sticky-sessions' }, { surge: 'error', loon: 'error', stash: 'error' }),
  group('lazy', 'url-test lazy=true', { type: 'url-test', test: { lazy: true } }, { surge: 'warning', loon: 'warning' }),
  group('expected-status', 'expected-status=204', { type: 'url-test', test: { expectedStatus: '204' } }, { surge: 'warning', loon: 'error', stash: 'error' }),
  group('max-failures', 'max-failed-times=3', { type: 'fallback', test: { maxFailedTimes: 3 } }, { surge: 'warning', loon: 'error', stash: 'error' }),
  group('hidden', 'hidden=true', { display: { hidden: true } }, { loon: 'warning' }),
  group('icon', 'icon URL', { display: { icon: 'https://example.test/icon.png' } }),
  group('extra', '扩展字段 disable-udp', { extra: { 'disable-udp': true } }, { surge: 'error', loon: 'error', stash: 'error' }),
  group('pass', 'PASS 成员', { members: [{ kind: 'builtin', name: 'PASS' }] }, { loon: 'error' }),
  ...[
    ['domain', 'DOMAIN,example.test'], ['suffix', 'DOMAIN-SUFFIX,example.test'], ['keyword', 'DOMAIN-KEYWORD,example'],
    ['wildcard', 'DOMAIN-WILDCARD,*.example.test'], ['cidr', 'IP-CIDR,192.0.2.0/24'], ['cidr6', 'IP-CIDR6,2001:db8::/32'],
    ['no-resolve', 'IP-CIDR,192.0.2.0/24,no-resolve'], ['asn', 'IP-ASN,13335,no-resolve'], ['geoip', 'GEOIP,CN,no-resolve'],
    ['port', 'DST-PORT,443'], ['src-port', 'SRC-PORT,12345'], ['port-range', 'DST-PORT,8000-9000'], ['port-list', 'DST-PORT,80/443'], ['src-port-list', 'SRC-PORT,80/443'],
    ['nested-port-list', 'AND,((DOMAIN,a.test),(NOT,((DST-PORT,80/443))))'],
    ['tcp', 'NETWORK,tcp'], ['udp', 'NETWORK,udp'], ['and', 'AND,((DOMAIN-SUFFIX,example.test),(DST-PORT,443))'],
    ['or', 'OR,((DOMAIN,a.test),(DOMAIN,b.test))'], ['not', 'NOT,((DOMAIN,a.test))'],
  ].map(([id, line]) => rule('rule-'+id!, line!, line!, undefined, id === 'wildcard' ? 'Loon 需 Build 1008+；复杂 wildcard 语法需逐端核对' : undefined)),
  rule('rule-geosite', 'GEOSITE,cn', 'GEOSITE,cn', { surge: 'omitted', loon: 'omitted' }),
  rule('rule-regex', 'DOMAIN-REGEX', 'DOMAIN-REGEX,^example[.]test$', { surge: 'omitted', loon: 'omitted' }),
  rule('rule-srcip', 'SRC-IP-CIDR', 'SRC-IP-CIDR,192.0.2.0/24', { loon: 'omitted' }),
  rule('rule-src', 'IP-CIDR src', 'IP-CIDR,192.0.2.0/24,src', { loon: 'omitted' }),
  rule('rule-process', 'PROCESS-NAME（由客户端处理平台能力）', 'PROCESS-NAME,Example'),
  rule('rule-proc-regex', '复杂进程正则（macOS）', 'PROCESS-NAME-REGEX,^(Foo|Bar)[0-9]+$', { surge: 'omitted', loon: 'omitted', stash: 'omitted' }),
  rule('rule-ua', 'USER-AGENT（非 Mihomo 通用项）', 'USER-AGENT,Example*', { mihomo: 'omitted' }),
  rule('rule-urlregex', 'URL-REGEX（非 Mihomo 通用项）', 'URL-REGEX,^https://example[.]test', { mihomo: 'omitted', stash: 'omitted' }),
  rule('rule-extended', 'extended-matching（Surge 专用）', 'DOMAIN,example.test,extended-matching', { mihomo: 'omitted', loon: 'omitted', stash: 'omitted' }),
];
// 让嵌套样例确实包含引用，避免仅测试 select 的重复配置。
compatibilityCases.find(c => c.id === 'nested')!.apply = f => {
  routing(f).groups.push({ id: 'nested', name: '外层', type: 'select', members: [{ kind: 'group', groupId: 'all' }] });
};
compatibilityCases.find(c => c.id === 'rule-proc-regex')!.apply = f => {
  f.platform = 'macos'; routing(f).rules = [{ id: 'process', matcher: { kind: 'rule', rule: parseRuleLine('PROCESS-NAME-REGEX,^(Foo|Bar)[0-9]+$') }, target: { kind: 'group', groupId: 'all' } }];
};
