// SSRF 防护（SYS-02）：远程拉取禁止访问内网与保留地址，管理员可配置白名单。
// 校验发生在建立连接时的 DNS 解析环节（guardedLookup），重定向与 DNS rebinding 同样受约束；
// URL 中直接写 IP 的情况不经过 DNS，由 assertUrlAllowed 预先检查。

import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';

export class SsrfError extends Error {}

const PRIVATE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'];
const PRIVATE_V6 = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '64:ff9b::/96'];

const PRIVATE = new BlockList();
for (const c of PRIVATE_V4) { const [a, p] = c.split('/'); PRIVATE.addSubnet(a!, Number(p), 'ipv4'); }
for (const c of PRIVATE_V6) { const [a, p] = c.split('/'); PRIVATE.addSubnet(a!, Number(p), 'ipv6'); }

export type AllowList = { hosts: Set<string>; nets: BlockList };

/** 白名单条目：主机名、IP 或 CIDR */
export function parseAllowList(entries: string[]): AllowList {
  const hosts = new Set<string>();
  const nets = new BlockList();
  for (const raw of entries.map((e) => e.trim()).filter(Boolean)) {
    const [addr, prefix] = raw.split('/');
    const v = isIP(addr!);
    if (v) nets.addSubnet(addr!, prefix === undefined ? (v === 4 ? 32 : 128) : Number(prefix), v === 4 ? 'ipv4' : 'ipv6');
    else hosts.add(raw.toLowerCase());
  }
  return { hosts, nets };
}

function normalize(addr: string): { addr: string; type: 'ipv4' | 'ipv6' } {
  // IPv4 映射的 IPv6 地址按 IPv4 判断
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (m) return { addr: m[1]!, type: 'ipv4' };
  return { addr, type: isIP(addr) === 6 ? 'ipv6' : 'ipv4' };
}

export function isBlockedAddress(address: string, allow: AllowList): boolean {
  const { addr, type } = normalize(address);
  if (allow.nets.check(addr, type)) return false;
  return PRIVATE.check(addr, type);
}

/** 检查 URL 协议与字面 IP 主机 */
export function assertUrlAllowed(url: URL, allow: AllowList): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError(`不支持的协议 ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (allow.hosts.has(host.toLowerCase())) return;
  if (isIP(host) && isBlockedAddress(host, allow)) throw new SsrfError(`禁止访问内网地址 ${host}`);
}

type LookupAll = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

const systemLookup: LookupAll = (hostname, cb) => dns.lookup(hostname, { all: true }, cb);

/**
 * 供 undici 建连使用的 lookup：解析结果中只要有一个内网地址就拒绝（白名单主机除外）。
 * 签名与 node:dns 的 lookup 一致。
 */
export function guardedLookup(allow: AllowList, base: LookupAll = systemLookup) {
  return (hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void): void => {
    base(hostname, (err, addresses) => {
      if (err) { callback(err); return; }
      const allowedHost = allow.hosts.has(hostname.toLowerCase());
      const blocked = allowedHost ? undefined : addresses.find((a) => isBlockedAddress(a.address, allow));
      if (blocked) { callback(new SsrfError(`禁止访问内网地址 ${hostname} → ${blocked.address}`)); return; }
      if (!addresses.length) { callback(new Error(`无法解析 ${hostname}`)); return; }
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}
