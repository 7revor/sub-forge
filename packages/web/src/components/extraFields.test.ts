import { describe, expect, it } from 'vitest';
import { formatExtraValue, parseExtraValue } from './extraFields.ts';

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
