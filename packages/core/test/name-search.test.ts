import { describe, expect, it } from 'vitest';
import { matchesNameSearch, nameLikePattern } from '../src/util/search.ts';

describe('名称字面模糊匹配', () => {
  it.each([['prefix-ClAuDe-tail', 'CLAUDE', true], ['ÄPFEL', 'äpf', true], ['前缀ＡＢＣ后缀', 'abc', true], ['A B_C-D', 'b_c-', true], ['A B_C-D', 'bcd', false], ['100%_target', '%_', true], ['100XXtarget', '%_', false], ['中文测试', '文测', true], ['abc', '[', false], ['abc', '', true]])('%s 包含 %s：%s', (name, query, expected) => {
    expect(matchesNameSearch(name, query)).toBe(expected);
  });
  it('SQL 参数对通配符和反斜线转义', () => {
    expect(nameLikePattern('  A%_\\B  ')).toBe('%a\\%\\_\\\\b%');
  });
});
