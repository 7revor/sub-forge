import { describe, expect, it } from 'vitest';
import { isOverridden, overrideValue } from './override.ts';
import { setPath } from './schema.ts';

describe('预设覆盖', () => {
  it('缺失路径继承，false、0、空字符串、null 和空列表均视为覆盖', () => {
    for (const value of [false, 0, '', null, []]) {
      expect(isOverridden({ dns: { enable: value } }, 'dns.enable')).toBe(true);
      expect(overrideValue({ dns: { enable: true } }, { dns: { enable: value } }, 'dns.enable')).toEqual(value);
    }
    expect(overrideValue({ dns: { enable: true } }, {}, 'dns.enable')).toBe(true);
    expect(isOverridden({ dns: {} }, 'dns.enable')).toBe(false);
    expect(isOverridden({ dns: { enable: undefined } }, 'dns.enable')).toBe(false);
    expect(isOverridden({}, 'toString')).toBe(false);
  });
  it('仅覆盖 allow-lan 和 dns.nameserver，数组整体替换，逐项还原清理空父对象', () => {
    const base = { 'allow-lan': false, dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['a', 'b'] } };
    const patch = setPath(setPath({}, 'allow-lan', true), 'dns.nameserver', ['c']);
    expect(patch).toEqual({ 'allow-lan': true, dns: { nameserver: ['c'] } });
    expect(overrideValue(base, patch, 'dns.nameserver')).toEqual(['c']);
    expect(overrideValue(base, patch, 'dns.enable')).toBe(true);
    const restored = setPath(patch, 'dns.nameserver', undefined);
    expect(restored).toEqual({ 'allow-lan': true });
    expect(overrideValue(base, restored, 'dns.nameserver')).toEqual(['a', 'b']);
    expect(setPath(restored, 'allow-lan', undefined)).toEqual({});
    expect(base.dns.nameserver).toEqual(['a', 'b']);
  });
});
