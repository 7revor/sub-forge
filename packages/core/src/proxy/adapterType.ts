/** 策略组 exclude-type 使用内核 Adapter Type 名称，节点配置则可能使用 ss / ssr 等别名。 */
const ADAPTER_NAMES = [
  'Shadowsocks', 'ShadowsocksR', 'Vmess', 'Vless', 'Trojan', 'Hysteria', 'Hysteria2',
  'Tuic', 'AnyTLS', 'Socks5', 'Http', 'Snell', 'WireGuard', 'Ssh', 'Mieru', 'Sudoku',
  'Masque', 'TrustTunnel', 'ShadowQuic', 'OpenVPN', 'Tailscale', 'ZeroTier', 'EasyTier',
  'GostRelay', 'Direct', 'Reject', 'RejectDrop', 'Compatible', 'Pass', 'PassRule', 'Dns',
  'Relay', 'Selector', 'Fallback', 'URLTest', 'LoadBalance',
];
const names = new Map(ADAPTER_NAMES.map(name => [name.toLowerCase(), name]));
const aliases: Record<string, string> = { ss: 'Shadowsocks', ssr: 'ShadowsocksR', hy2: 'Hysteria2', 'wire-guard': 'WireGuard', 'reject-drop': 'RejectDrop', 'url-test': 'URLTest', 'load-balance': 'LoadBalance', select: 'Selector' };

export function adapterTypeName(type: string): string {
  const value = type.trim();
  return aliases[value.toLowerCase()] ?? names.get(value.toLowerCase()) ?? value;
}

export function excludedAdapterTypes(value?: string): string[] {
  return [...new Set((value ?? '').split('|').map(adapterTypeName).filter(Boolean))];
}

export function isExcludedAdapter(type: string, excluded: readonly string[]): boolean {
  const key = adapterTypeName(type).toLowerCase();
  return excluded.some(item => item.toLowerCase() === key);
}
