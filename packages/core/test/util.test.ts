import { describe, expect, it } from 'vitest';
import { compileUserRegex, exactNameRegex, stableHash, stableStringify } from '../src/index.ts';

describe('stableHash', () => {
  it('同一输入结果稳定，不同输入结果不同', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('')).toHaveLength(16);
  });

  it('对 Unicode 按 UTF-8 字节计算', () => {
    expect(stableHash('🇭🇰 HK-01')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('stableStringify', () => {
  it('键顺序不影响结果，忽略 undefined', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(stableStringify({ a: [2, { d: 3 }], b: 1 }));
  });
});

describe('regex', () => {
  it('exactNameRegex 只命中原名', () => {
    const re = new RegExp(exactNameRegex('🇭🇰 HK (IPLC) 01.x'), 'u');
    expect(re.test('🇭🇰 HK (IPLC) 01.x')).toBe(true);
    expect(re.test('🇭🇰 HK (IPLC) 01ax')).toBe(false);
    expect(re.test('🇭🇰 HK (IPLC) 01.x 2')).toBe(false);
  });

  it('compileUserRegex 支持 (?i)，非法正则报错', () => {
    expect(compileUserRegex('(?i)hk').test('HK-01')).toBe(true);
    expect(() => compileUserRegex('([')).toThrow(/非法正则/);
  });
});
