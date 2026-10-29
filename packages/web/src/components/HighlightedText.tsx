import { Fragment } from 'react';
import type { SearchMatch } from '@sub-forge/core';

/** 仅渲染原文切片，不解析 HTML；区间由实际搜索字段生成，不高亮来源说明。 */
export function HighlightedText({ text, matches = [] }: { text: string; matches?: SearchMatch[] }) {
  return <>{matches.map((range, index) => <Fragment key={`${range.start}:${range.end}`}>
    {text.slice(index ? matches[index - 1]!.end : 0, range.start)}
    <mark className="rounded-sm bg-amber-200 text-amber-950">{text.slice(range.start, range.end)}</mark>
  </Fragment>)}{text.slice(matches.at(-1)?.end ?? 0)}</>;
}
