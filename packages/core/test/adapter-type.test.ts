import { describe, expect, it } from 'vitest';
import { adapterTypeName, excludedAdapterTypes, isExcludedAdapter } from '../src/proxy/adapterType.ts';

describe('排除协议与 Mihomo 类型一致', () => {
  it('兼容旧别名、大小写和空格，去重且允许未来协议', () => {
    expect(excludedAdapterTypes(' SS | shadowsocks|HTTP|hy2| |FutureType')).toEqual(['Shadowsocks', 'Http', 'Hysteria2', 'FutureType']);
    expect(isExcludedAdapter('ss', ['Shadowsocks'])).toBe(true);
    expect(isExcludedAdapter('VLESS', ['Vless'])).toBe(true);
    expect(isExcludedAdapter('http', [])).toBe(false);
    expect(adapterTypeName('ssr')).toBe('ShadowsocksR');
  });
});
