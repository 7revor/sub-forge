import { BlockList, isIP } from 'node:net';

export type ClientAddress = {
  clientIp: string | null;
  peerIp: string | null;
  ipSource: 'socket' | 'x-forwarded-for' | 'unknown';
};

/** 只接受裸 IP；不把端口、域名、区域标识或任意请求头文本写进日志。 */
export function normalizeIp(value: string | undefined): string | undefined {
  if (!value || value.includes('%') || !isIP(value)) return undefined;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** 可信代理只接受明确 IP / CIDR；不隐式信任内网、环回地址或固定跳数。 */
export function parseTrustedProxies(value = ''): BlockList {
  const nets = new BlockList();
  if (!value.trim()) return nets;
  for (const entry of value.split(',')) {
    const parts = entry.trim().split('/');
    const raw = parts[0]!, address = normalizeIp(raw);
    const family = isIP(raw), max = family === 4 ? 32 : 128;
    const prefixText = parts[1];
    let prefix = prefixText === undefined ? max : Number(prefixText);
    if (!address || parts.length > 2 || (prefixText !== undefined && !/^\d+$/.test(prefixText)) || !Number.isInteger(prefix) || prefix < 1 || prefix > max) {
      throw new Error(`SUBFORGE_TRUSTED_PROXIES 条目无效：${entry}；请填写 IP 或非全网 CIDR`);
    }
    if (family === 6 && isIP(address) === 4) {
      if (prefix <= 96) throw new Error(`SUBFORGE_TRUSTED_PROXIES 映射地址范围过大：${entry}`);
      prefix -= 96;
    }
    nets.addSubnet(address, prefix, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return nets;
}

/** 从连接对端向左剥离可信代理，在第一个非可信地址处停止。 */
export function resolveClientAddress(peer: string | undefined, forwardedFor: string | undefined, trusted: BlockList): ClientAddress {
  const peerIp = normalizeIp(peer) ?? null;
  const direct: ClientAddress = { clientIp: peerIp, peerIp, ipSource: peerIp ? 'socket' : 'unknown' };
  const isTrusted = (ip: string) => trusted.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  if (!peerIp || !isTrusted(peerIp) || !forwardedFor || forwardedFor.length > 4096) return direct;
  const chain = forwardedFor.split(',');
  if (chain.length > 32) return direct;
  let address = peerIp;
  for (let i = chain.length - 1; i >= 0 && isTrusted(address); i--) {
    const next = normalizeIp(chain[i]!.trim());
    // 可信链段格式错误时回退连接来源，不越过错误位置猜测客户端。
    if (!next) return direct;
    address = next;
  }
  return { clientIp: address, peerIp, ipSource: 'x-forwarded-for' };
}
