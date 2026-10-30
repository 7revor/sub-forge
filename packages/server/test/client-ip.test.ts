import { expect, it } from 'vitest';
import { normalizeIp, parseTrustedProxies, resolveClientAddress } from '../src/net/client-ip.ts';

it.each([
  ['192.0.2.1', '192.0.2.1'], ['2001:0DB8:0:0::1', '2001:db8::1'],
  ['::ffff:192.0.2.1', '192.0.2.1'], ['::ffff:c000:201', '192.0.2.1'],
  ['192.0.2.1:80', undefined], ['[2001:db8::1]:443', undefined], ['unknown', undefined],
  ['fe80::1%eth0', undefined], ['example.test', undefined], ['127.1', undefined],
])('规范化裸地址 %s', (value, expected) => expect(normalizeIp(value)).toBe(expected));

it.each(['*', 'true', '1', 'localhost', '10.0.0.1/no', '10.0.0.0/33', '::/129', '0.0.0.0/0', '::/0', '10.0.0.0/-1', '10.0.0.0/', '10.0.0.1,,::1', '10.0.0.1/8/2', '::ffff:0:0/96'])('拒绝错误或全网信任配置 %s', value => {
  expect(() => parseTrustedProxies(value)).toThrow('SUBFORGE_TRUSTED_PROXIES');
});

it('默认不信任转发头；缺少连接信息时不从头部推测 IP', () => {
  expect(resolveClientAddress('::ffff:127.0.0.1', '198.51.100.9', parseTrustedProxies())).toEqual({ clientIp: '127.0.0.1', peerIp: '127.0.0.1', ipSource: 'socket' });
  expect(resolveClientAddress(undefined, '198.51.100.9', parseTrustedProxies('127.0.0.1'))).toEqual({ clientIp: null, peerIp: null, ipSource: 'unknown' });
});

it('可信链从右到左解析，非可信中间节点隔断其左侧伪造值', () => {
  const trusted = parseTrustedProxies('10.2.0.0/24, 2001:db8:1::/48');
  expect(resolveClientAddress('10.2.0.2', '198.51.100.9, 2001:db8:1::2, 10.2.0.3', trusted)).toEqual({ clientIp: '198.51.100.9', peerIp: '10.2.0.2', ipSource: 'x-forwarded-for' });
  expect(resolveClientAddress('10.2.0.2', '伪造, 192.0.2.7, 10.2.0.3', trusted).clientIp).toBe('192.0.2.7');
  expect(resolveClientAddress('192.0.2.7', '198.51.100.9', trusted).ipSource).toBe('socket');
  expect(resolveClientAddress('10.2.0.2', '10.2.0.8, 10.2.0.3', trusted).clientIp).toBe('10.2.0.8');
});

it.each(['unknown', '198.51.100.9, ', '198.51.100.9, invalid, 10.2.0.3', '198.51.100.9:42', '[2001:db8::1]', Array(33).fill('10.2.0.3').join(','), ' '.repeat(4097)])('可信链错误或过长时回退连接来源：%s', header => {
  expect(resolveClientAddress('10.2.0.2', header, parseTrustedProxies('10.2.0.0/24'))).toEqual({ clientIp: '10.2.0.2', peerIp: '10.2.0.2', ipSource: 'socket' });
});

it('IPv6 与 IPv4 映射 CIDR 正常匹配，空转发头回退', () => {
  const trusted = parseTrustedProxies('::ffff:10.2.0.0/120, ::1');
  expect(resolveClientAddress('::ffff:a02:2', '2001:db8::5', trusted).clientIp).toBe('2001:db8::5');
  expect(resolveClientAddress('::1', '', trusted).ipSource).toBe('socket');
  expect(resolveClientAddress('10.2.1.2', '2001:db8::5', trusted).ipSource).toBe('socket');
});
