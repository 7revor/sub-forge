import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HighlightedText } from './HighlightedText.tsx';

const mark = 'class="rounded-sm bg-amber-200 text-amber-950"';
describe('搜索词展示', () => {
  it('按原文字段区间高亮，其余文字与字符大小写保持原样', () => {
    expect(renderToStaticMarkup(<HighlightedText text="AI/OpenＡＩ.txt" matches={[{ start: 0, end: 2 }, { start: 7, end: 9 }]} />))
      .toBe(`<mark ${mark}>AI</mark>/Open<mark ${mark}>ＡＩ</mark>.txt`);
  });
  it('候选文本和命中片段都按普通文本转义，不能插入 HTML', () => {
    const text = '<img src=x onerror=alert(1)>.txt';
    const output = renderToStaticMarkup(<HighlightedText text={text} matches={[{ start: 0, end: 4 }]} />);
    expect(output).toContain('&lt;img</mark>');
    expect(output).not.toContain('<img');
    expect(renderToStaticMarkup(<HighlightedText text="OpenAI.txt" />)).toBe('OpenAI.txt');
  });
});
