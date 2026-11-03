import { expect, it } from 'vitest';
import { normalizeIp } from '../src/net/client-ip.ts';

it.each([
  ['192.0.2.1', '192.0.2.1'], ['2001:0DB8:0:0::1', '2001:db8::1'],
  ['::ffff:192.0.2.1', '192.0.2.1'], ['::ffff:c000:201', '192.0.2.1'],
  ['192.0.2.1:80', undefined], ['[2001:db8::1]:443', undefined], ['unknown', undefined],
  ['fe80::1%eth0', undefined], ['example.test', undefined], ['127.1', undefined],
])('规范化裸地址 %s', (value, expected) => expect(normalizeIp(value)).toBe(expected));
