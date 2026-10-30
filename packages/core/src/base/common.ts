import type { Client, Platform } from '../types.ts';
import { Report, type ReportItem } from '../report.ts';
type Fields = Record<string, unknown>;
/** 公共层只表达已确认的意图；其余设置保留在客户端覆盖中。 */
export type CommonBase = {
  dnsServers?: string[];
  dnsIpv6?: boolean;
  hosts?: Record<string, string>;
  dnsPolicy?: Record<string, string>;
  realIpDomains?: string[];
  geoipUrl?: string;
  httpPort?: number;
  socksPort?: number;
  allowLan?: boolean;
  testUrl?: string;
  testTimeoutMs?: number;
};
const object = (x: unknown): x is Fields => !!x && typeof x === 'object' && !Array.isArray(x);
const domain = (s: string) => !['__proto__', 'constructor', 'prototype'].includes(s) && /^(?:[a-z0-9_-]+\.)*[a-z0-9_-]+$/i.test(s);
const ip = (s: string) => {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return s.split('.').every(n => +n < 256);
  if (!s.includes(':')) return false;
  try { return new URL('http://[' + s + ']/').hostname.startsWith('['); } catch { return false; }
};
const dns = (s: string) => ip(s) || s === 'system';
const list = (x: unknown): string[] | undefined => Array.isArray(x) && x.every(v => typeof v === 'string') ? x : typeof x === 'string' ? x.split(',').map(v => v.trim()) : undefined;
export function mergeBase(base: Fields, patch: Fields): Fields {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('基础配置包含非法键');
    out[k] = object(out[k]) && object(v) ? mergeBase(out[k], v) : structuredClone(v);
  }
  return out;
}
export function validateCommonBase(value: unknown): asserts value is CommonBase {
  if (!object(value)) throw new Error('公共基础配置必须是对象');
  const known = new Set(['dnsServers', 'dnsIpv6', 'hosts', 'dnsPolicy', 'realIpDomains', 'geoipUrl', 'httpPort', 'socksPort', 'allowLan', 'testUrl', 'testTimeoutMs']);
  for (const [key, v] of Object.entries(value)) {
    if (!known.has(key)) throw new Error('未知公共字段：' + key + '，请放入对应客户端覆盖');
    if (['dnsIpv6', 'allowLan'].includes(key) && typeof v !== 'boolean') throw new Error(key + ' 必须为布尔值');
    if (['httpPort', 'socksPort'].includes(key) && (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 65535)) throw new Error(key + ' 必须为 0—65535 的整数');
    if (key === 'testTimeoutMs' && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error('测速超时必须为正数，单位毫秒');
    if (['geoipUrl', 'testUrl'].includes(key) && (typeof v !== 'string' || !/^https?:\/\/[^\s]+$/.test(v))) throw new Error(key + ' 必须为 HTTP(S) 地址');
    if (['dnsServers', 'realIpDomains'].includes(key) && (!Array.isArray(v) || !v.every(x => typeof x === 'string' && (key === 'dnsServers' ? dns(x) : domain(x))))) throw new Error(key + ' 仅支持普通 DNS IP/system 或精确域名；通配符和加密 DNS 请使用专用覆盖');
    if (['hosts', 'dnsPolicy'].includes(key) && (!object(v) || !Object.entries(v).every(([k, x]) => domain(k) && typeof x === 'string' && (key === 'hosts' ? ip(x) : dns(x))))) throw new Error(key + ' 仅支持精确域名到单个 IP/DNS 的映射');
  }
  if (object(value.hosts) && object(value.dnsPolicy) && Object.keys(value.hosts).some(k => Object.hasOwn(value.dnsPolicy as Fields, k))) throw new Error('同一域名不能同时配置固定地址和指定 DNS');
}
export function lowerCommonBase(common: CommonBase, client: Client, platform?: Platform, native: Fields = {}): { base: Fields; report: ReportItem[] } {
  validateCommonBase(common);
  const report = new Report(), base: Fields = {}, general: Fields = {}, host: Fields = {}, d: Fields = {};
  const yaml = client === 'mihomo' || client === 'stash';
  if (common.dnsServers !== undefined) yaml ? d.nameserver = common.dnsServers : general['dns-server'] = common.dnsServers;
  if (common.dnsIpv6 !== undefined) {
    if (yaml) d.ipv6 = common.dnsIpv6;
    else if (client === 'surge') general.ipv6 = common.dnsIpv6;
    else if (object(native.general) && native.general['ip-mode'] !== undefined) report.warn('base.native-override', '公共 DNS IPv6 查询开关无法等价映射到 Loon，已使用显式设置的 Loon ip-mode；此模式同时控制连接');
    else report.error('base.ipv6-semantics', 'Loon ip-mode 同时控制连接，不能等价表达仅控制 AAAA 查询；请清除公共 DNS IPv6 项并使用 Loon 专用覆盖');
  }
  if (common.hosts) yaml ? base.hosts = common.hosts : Object.assign(host, common.hosts);
  if (common.dnsPolicy) {
    if (yaml) d['nameserver-policy'] = common.dnsPolicy;
    else for (const [name, server] of Object.entries(common.dnsPolicy)) host[name] = 'server:' + server;
  }
  if (common.realIpDomains !== undefined) {
    if (yaml) d['fake-ip-filter'] = common.realIpDomains;
    else general[client === 'surge' ? 'always-real-ip' : 'real-ip'] = common.realIpDomains;
  }
  if (yaml && Object.keys(d).length) { if (client === 'mihomo') { d.enable = true; if (common.hosts) d['use-hosts'] = true; } base.dns = d; }
  else if (client === 'mihomo' && common.hosts) base.dns = { enable: true, 'use-hosts': true };
  if (client === 'stash' && common.dnsIpv6 === true) report.warn('base.ipv6-auto', 'Stash 的 dns.ipv6=true 仍由当前网络决定是否查询 AAAA，不强制启用 IPv6 查询');
  if (common.geoipUrl !== undefined) {
    if (client === 'mihomo') { base['geodata-mode'] = false; base['geox-url'] = { mmdb: common.geoipUrl }; }
    else if (client === 'stash') report.error('base.geoip-unsupported', 'Stash 尚未适配公共 GeoIP 数据库地址，请使用专用覆盖');
    else general[client === 'surge' ? 'geoip-maxmind-url' : 'geoip-url'] = common.geoipUrl;
  }
  if (common.httpPort !== undefined || common.socksPort !== undefined || common.allowLan !== undefined) {
    if (client === 'mihomo') {
      if (common.httpPort !== undefined) base.port = common.httpPort;
      if (common.socksPort !== undefined) base['socks-port'] = common.socksPort;
      if (common.allowLan !== undefined) base['allow-lan'] = common.allowLan;
    } else if (client === 'surge' && platform === 'macos') {
      const bind = common.allowLan ? '0.0.0.0:' : '127.0.0.1:';
      if (common.httpPort) general['http-listen'] = bind + common.httpPort;
      if (common.socksPort) general['socks5-listen'] = bind + common.socksPort;
      if (common.allowLan !== undefined && common.httpPort === undefined && common.socksPort === undefined) report.error('base.listener-incomplete', 'Surge macOS 的局域网开放需要同时指定公共监听端口');
    } else if (client === 'loon' || client === 'surge' && platform === 'ios') {
      if (common.httpPort === 0 || common.socksPort === 0) report.error('base.listener-zero', 'Wi-Fi 代理端口不支持以 0 关闭单个监听，请使用客户端专用覆盖');
      if (common.allowLan !== undefined) general['allow-wifi-access'] = common.allowLan;
      if (common.httpPort) general['wifi-access-http-port'] = common.httpPort;
      if (common.socksPort) general['wifi-access-socks5-port'] = common.socksPort;
      report.warn('base.listener-scope', client + ' 的公共端口映射为 Wi-Fi 代理共享端口，本机代理接管仍由客户端管理');
    } else report.error('base.listener-platform', client === 'surge' ? '公共监听端口需要明确 Surge 平台（macos 或 ios）' : 'Stash 尚未适配公共监听端口，请使用专用覆盖');
  }
  if (!yaml) {
    if (common.testUrl !== undefined) general['proxy-test-url'] = common.testUrl;
    if (common.testTimeoutMs !== undefined) general['test-timeout'] = common.testTimeoutMs / 1000;
    if (Object.keys(general).length) base.general = general;
    if (Object.keys(host).length) base.host = host;
  }
  return { base, report: report.items };
}

/** 提取可证明等价的部分；保留全部未转换原生字段，并逐项说明。 */
export function extractCommonBase(input: Fields, client: Client): { common: CommonBase; native: Fields; report: ReportItem[] } {
  const native = structuredClone(input), common: CommonBase = {}, report = new Report();
  const yaml = client === 'mihomo' || client === 'stash';
  const g = (yaml ? native : native.general) as Fields | undefined;
  const d = (yaml && (native.dns as Fields)?.enable === false ? undefined : yaml ? native.dns : g) as Fields | undefined;
  const take = (obj: Fields | undefined, key: string, target: keyof CommonBase, accept: (v: unknown) => boolean, convert: (v: unknown) => unknown = v => v) => {
    if (obj?.[key] !== undefined && accept(obj[key])) { (common as Fields)[target] = convert(obj[key]); delete obj[key]; }
  };
  take(d, yaml ? 'nameserver' : 'dns-server', 'dnsServers', v => !!list(v)?.every(dns), v => list(v));
  if (client !== 'loon') take(d, 'ipv6', 'dnsIpv6', v => typeof v === 'boolean');
  take(d, yaml ? 'fake-ip-filter' : client === 'surge' ? 'always-real-ip' : 'real-ip', 'realIpDomains', v => (!yaml || !d?.['fake-ip-filter-mode'] || d['fake-ip-filter-mode'] === 'blacklist') && !!list(v)?.every(domain), v => list(v));
  const hosts = (yaml ? native.hosts : native.host) as Fields | undefined;
  // 有任意通配/特殊条目时整体保留，避免破坏 INI 顺序优先语义。
  if (object(hosts) && Object.entries(hosts).every(([k, v]) => domain(k) && typeof v === 'string' && (ip(v) || !yaml && v.startsWith('server:') && dns(v.slice(7))))) {
    for (const [k, v] of Object.entries(hosts) as [string,string][]) {
      if (v.startsWith('server:')) (common.dnsPolicy ??= {})[k] = v.slice(7); else (common.hosts ??= {})[k] = v;
    }
    delete native[yaml ? 'hosts' : 'host'];
  }
  take(d, 'nameserver-policy', 'dnsPolicy', v => object(v) && Object.entries(v).every(([k, x]) => domain(k) && typeof x === 'string' && dns(x)));
  if (client === 'mihomo') {
    take(native, 'port', 'httpPort', v => Number.isInteger(v)); take(native, 'socks-port', 'socksPort', v => Number.isInteger(v)); take(native, 'allow-lan', 'allowLan', v => typeof v === 'boolean');
    if (native['geodata-mode'] !== true) take(native['geox-url'] as Fields, 'mmdb', 'geoipUrl', v => typeof v === 'string');
  } else if (!yaml) {
    take(g, client === 'loon' ? 'geoip-url' : 'geoip-maxmind-url', 'geoipUrl', v => typeof v === 'string');
    take(g, 'proxy-test-url', 'testUrl', v => typeof v === 'string');
    take(g, 'test-timeout', 'testTimeoutMs', v => typeof v === 'number' && v > 0, v => Number(v) * 1000);
    // Wi-Fi 与桌面 loopback 监听范围不同，导入时不擅自升级为公共意图。
  }
  const walk = (obj: Fields, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix + key;
      if (object(value) && Object.keys(value).length === 0) { delete obj[key]; continue; }
      report.warn('base.native-only', client + ' 的 ' + path + ' 保留在专用覆盖中，未自动转换到其他客户端（需核对匹配范围、平台或行为）', path);
    }
  };
  if (object(native.general)) walk(native.general, 'general.');
  if (object(native.dns)) walk(native.dns, 'dns.');
  walk(Object.fromEntries(Object.entries(native).filter(([k]) => !['general', 'dns'].includes(k))));
  validateCommonBase(common);
  return { common, native, report: report.items };
}
