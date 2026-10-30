import type { ReportItem } from '@sub-forge/core';
import { CircleAlert, Info, LocateFixed, TriangleAlert } from 'lucide-react';
import type { CodeRange } from '../../components/CodePreview.tsx';
import { cx } from '../../components/cx.ts';
import { previewIssueMessage } from './previewReport.ts';

const LEVEL = {
  error: { label: '错误', icon: CircleAlert, className: 'text-err' },
  warn: { label: '告警', icon: TriangleAlert, className: 'text-warn' },
  info: { label: '提示', icon: Info, className: 'text-accent-ink' },
};

export function PreviewReport({ items, locations, selected, onLocate }: {
  items: ReportItem[]; locations: (CodeRange | undefined)[]; selected?: number; onLocate: (index: number) => void;
}) {
  if (!items.length) return <p className="m-0 text-[13px] text-ok">没有问题</p>;
  return <ul className="m-0 list-none p-0">{items.map((item, i) => {
    const level = LEVEL[item.level], Icon = level.icon, location = locations[i];
    const message = previewIssueMessage(item);
    const description = `${level.label}：${item.message}${location ? `；点击定位第 ${location.startLine} 行` : ''}`;
    const className = cx('flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px]', location && 'cursor-pointer hover:bg-accent-soft focus-visible:outline-brand', selected === i && 'bg-accent-soft');
    const content = <><Icon size={14} aria-hidden className={cx('shrink-0', level.className)} /><span className="min-w-0 flex-1 truncate">{message}</span>{location && <LocateFixed size={13} aria-hidden className="shrink-0 text-ink-muted" />}</>;
    return <li key={i} className="border-b border-line-2 last:border-0">{location
      ? <button type="button" title={description} aria-label={description} aria-pressed={selected === i} className={className} onClick={() => onLocate(i)}>{content}</button>
      : <div tabIndex={0} title={description} aria-label={description} className={className}>{content}</div>}
    </li>;
  })}</ul>;
}
