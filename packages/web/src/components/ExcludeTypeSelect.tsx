import { excludedAdapterTypes } from '@sub-forge/core';
import { MultiSelect } from './listbox.tsx';

const TYPES = [
  ['Shadowsocks', 'Shadowsocks（SS）'], ['ShadowsocksR', 'ShadowsocksR（SSR）'],
  ['Vmess', 'VMess'], ['Vless', 'VLESS'], ['Trojan', 'Trojan'], ['Hysteria', 'Hysteria'],
  ['Hysteria2', 'Hysteria 2'], ['Tuic', 'TUIC'], ['AnyTLS', 'AnyTLS'], ['Socks5', 'SOCKS5'],
  ['Http', 'HTTP'], ['Snell', 'Snell'], ['WireGuard', 'WireGuard'], ['Ssh', 'SSH'], ['Mieru', 'Mieru'],
  ['Sudoku', 'Sudoku'], ['Masque', 'MASQUE'], ['TrustTunnel', 'TrustTunnel'], ['ShadowQuic', 'ShadowQUIC'],
  ['OpenVPN', 'OpenVPN'], ['Tailscale', 'Tailscale'], ['ZeroTier', 'ZeroTier'], ['EasyTier', 'EasyTier'],
] as const;

export function ExcludeTypeSelect({ id, value, onChange }: { id?: string; value?: string; onChange: (value: string | undefined) => void }) {
  const selected = excludedAdapterTypes(value);
  const known = new Set<string>(TYPES.map(([type]) => type));
  return <MultiSelect id={id} aria-label="exclude-type（排除协议）" value={selected} onChange={next => onChange(next.join('|') || undefined)} placeholder="选择需要排除的节点协议类型">
    {TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
    {selected.filter(type => !known.has(type)).map(type => <option key={type} value={type}>{type}</option>)}
  </MultiSelect>;
}
