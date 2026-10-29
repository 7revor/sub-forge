import { describe, expect, it } from 'vitest';
import { extraNameError, formatExtraValue, parseExtraValue } from './extraFields.ts';

describe('其他字段的 YAML 值', () => {
  it.each([true, false, 0, null, '', 'true', 'a\nb', ['a', 'b'], { nested: { a: 1 }, list: [false] }])('单行显示并往返 %#', (value) => {
    const text = formatExtraValue(value);
    expect(text).not.toContain('\n');
    expect(parseExtraValue(text)).toEqual({ ok: true, value });
  });
  it('接受多行 YAML 片段', () => {
    expect(parseExtraValue('a:\n  - b\n  - c')).toEqual({ ok: true, value: { a: ['b', 'c'] } });
  });
  it('解析失败返回错误', () => {
    const result = parseExtraValue('[broken');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });
});

it('新增和重命名均检查保留字段，同时允许保持原名', () => {
  const value = { custom: 1, other: 2 };
  const validate = (name: string) => name === 'name' ? '不能覆盖节点名称' : undefined;
  expect(extraNameError(value, '', undefined, validate)).toBeTruthy();
  expect(extraNameError(value, 'other', 'custom', validate)).toBeTruthy();
  expect(extraNameError(value, 'custom', 'custom', validate)).toBeUndefined();
  expect(extraNameError(value, 'name', undefined, validate)).toBe('不能覆盖节点名称');
  expect(extraNameError(value, 'name', 'custom', validate)).toBe('不能覆盖节点名称');
  expect(extraNameError(value, 'fresh', 'custom', validate)).toBeUndefined();
});
