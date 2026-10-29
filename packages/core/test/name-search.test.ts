import { describe, expect, it } from 'vitest';
import { matchesNameSearch, nameLikePattern, nameSearchRanges } from '../src/util/search.ts';

describe('名称字面模糊匹配', () => {
  it.each([['prefix-ClAuDe-tail', 'CLAUDE', true], ['ÄPFEL', 'äpf', true], ['前缀ＡＢＣ后缀', 'abc', true], ['A B_C-D', 'b_c-', true], ['A B_C-D', 'bcd', false], ['100%_target', '%_', true], ['100XXtarget', '%_', false], ['中文测试', '文测', true], ['abc', '[', false], ['abc', '', true]])('%s 包含 %s：%s', (name, query, expected) => {
    expect(matchesNameSearch(name, query)).toBe(expected);
  });
  it('SQL 参数对通配符和反斜线转义', () => {
    expect(nameLikePattern('  A%_\\B  ')).toBe('%a\\%\\_\\\\b%');
  });
});

describe('搜索命中回映原文', () => {
  it.each([
    ['AI/OpenAI.list', 'ai', ['AI', 'AI']],
    ['前缀ＡＩ后缀', '  ai  ', ['ＡＩ']],
    ['A\u0308PFEL.txt', 'äpf', ['A\u0308PF']],
    ['ﬃ.txt', 'fi', ['ﬃ']],
    ['🧭/OpenAI.txt', 'ai', ['AI']],
    ['ΟΣ/', 'ος', ['ΟΣ']],
    ['100%_[x].txt', '%_[', ['%_[']],
    ['aaaa', 'aa', ['aaaa']],
    ['OpenAI.txt', '', []],
    ['OpenAI.txt', 'missing', []],
  ])('%s 的 %s 保留原文字形', (text, query, expected) => {
    expect(nameSearchRanges(text, query).map(range => text.slice(range.start, range.end))).toEqual(expected);
  });
});
