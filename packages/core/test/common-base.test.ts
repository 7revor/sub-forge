import { expect, it } from 'vitest';
import { extractCommonBase, lowerCommonBase, mergeBase, validateCommonBase, renderMihomo } from '../src/index.ts';
import { iniFixture, routing } from './fixtures/ini-client.ts';
it('公共 DNS、精确 Host 与真实 IP 排除映射，保留 false 和 0', () => {
  const common = { dnsServers: ['223.5.5.5'], hosts: { 'a.test': '192.0.2.1' }, dnsPolicy: { 'b.test': '1.1.1.1' }, realIpDomains: ['c.test'] };
  expect(lowerCommonBase(common, 'mihomo').base).toMatchObject({ dns: { nameserver: ['223.5.5.5'], 'nameserver-policy': { 'b.test': '1.1.1.1' }, 'fake-ip-filter': ['c.test'], 'use-hosts': true } });
  for (const client of ['loon', 'surge'] as const) expect(lowerCommonBase(common, client).base).toMatchObject({ general: { 'dns-server': ['223.5.5.5'] }, host: { 'a.test': '192.0.2.1', 'b.test': 'server:1.1.1.1' } });
  expect(lowerCommonBase({ dnsIpv6: false, httpPort: 0, allowLan: false }, 'mihomo').base).toMatchObject({ port: 0, 'allow-lan': false, dns: { ipv6: false } });
});
it('保留专用项，不扩大通配符范围，也不混淆 IPv6 查询和连接', () => {
  const input = { general: { 'dns-server': ['223.5.5.5'], 'ip-mode': 'v4-only', 'real-ip': ['*.apple.com'], 'disable-stun': false }, host: { '*.test': 'server:1.1.1.1' } };
  const before = structuredClone(input), out = extractCommonBase(input, 'loon');
  expect(input).toEqual(before); expect(out.common).toEqual({ dnsServers: ['223.5.5.5'] });
  expect(out.native).toMatchObject({ general: { 'ip-mode': 'v4-only', 'disable-stun': false }, host: input.host });
  expect(out.report).toHaveLength(4);
  expect(lowerCommonBase({ dnsIpv6: false }, 'loon').report[0]!.level).toBe('error');
  expect(() => validateCommonBase({ realIpDomains: ['*orb.local'] })).toThrow();
});
it('Mihomo 白名单 FakeIP、关闭的 DNS 和 TUN 不自动挪到公共层', () => {
  const out = extractCommonBase({ dns: { enable: false, nameserver: ['1.1.1.1'], 'fake-ip-filter-mode': 'whitelist', 'fake-ip-filter': ['a.test'] }, tun: { stack: 'mips' } }, 'mihomo');
  expect(out.common).toEqual({}); expect(out.native).toHaveProperty('tun.stack', 'mips');
});
it('合并公共项后原生覆盖生效，数组替换，禁止污染键和无效公共字段', () => {
  const base = lowerCommonBase({ dnsServers: ['223.5.5.5'], hosts: { 'a.test': '192.0.2.1' } }, 'mihomo').base;
  const out = mergeBase(base, { dns: { nameserver: ['1.1.1.1'], enable: false } });
  expect(out).toHaveProperty('dns.nameserver', ['1.1.1.1']); expect(out).toHaveProperty('dns.enable', false);
  expect(() => mergeBase({}, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
  for (const value of [{ unknown: true }, { testTimeoutMs: 0 }, { httpPort: -1 }, { dnsServers: ['https://example.test/dns-query'] }]) expect(() => validateCommonBase(value)).toThrow();
});
it('公共测速默认值进入组，显式组参数优先且不修改输入', () => {
  const f = iniFixture(); f.base = {}; routing(f).rules = [];
  f.common = { testUrl: 'https://example.test/204', testTimeoutMs: 3000 };
  routing(f).groups[0]!.type = 'url-test'; routing(f).groups[0]!.test = { timeout: 2000 };
  const before = JSON.stringify(f); const out = renderMihomo(f);
  expect((out.config['proxy-groups'] as unknown[])[0]).toMatchObject({ url: 'https://example.test/204', timeout: 2000 });
  expect(JSON.stringify(f)).toEqual(before);
});
it('显式 Loon 协议覆盖允许公共 DNS 查询项降级，并明确提示范围差异', () => {
  const out = lowerCommonBase({ dnsIpv6: false }, 'loon', 'ios', { general: { 'ip-mode': 'v4-only' } });
  expect(out.report).toEqual([expect.objectContaining({ level: 'warn', code: 'base.native-override' })]);
  for (const addr of [':::', 'gg::1', '999.1.1.1']) expect(() => validateCommonBase({ hosts: { 'a.test': addr } })).toThrow();
  expect(() => validateCommonBase({ hosts: { 'a.test': '2001:db8::1' } })).not.toThrow();
  expect(lowerCommonBase({ httpPort: 0, socksPort: 0 }, 'surge', 'macos').base).toEqual({});
});
