import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { CopyButton } from './CopyButton.tsx';
import { cx } from './cx.ts';

/** 只负责只读文本展示；请求、错误与空结果语义由使用方决定。 */
export type CodeRange = { startLine: number; endLine: number };

export function CodePreview({ text, title, label, copyable = false, loading = false, lineNumbers = false, fill = false, highlight, className, bodyClassName }: {
  lineNumbers?: boolean; fill?: boolean; text: string; title?: ReactNode; label?: string; copyable?: boolean; loading?: boolean; className?: string; bodyClassName?: string;
  highlight?: CodeRange;
}) {
  const body = useRef<HTMLPreElement>(null);
  const marked = useRef<HTMLElement>(null);
  const lines = text.split('\n');
  const range = highlight && highlight.startLine > 0 && highlight.endLine >= highlight.startLine && highlight.endLine <= lines.length ? highlight : undefined;
  useLayoutEffect(() => {
    const container = body.current, target = marked.current;
    if (!container || !target || !highlight) return;
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    // 只滚动正文，不通过 scrollIntoView 带动外层页面或右侧报告。
    container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), left: 0 });
  }, [highlight, text]);
  const content = range ? <>{lines.slice(0, range.startLine - 1).join('\n')}{range.startLine > 1 && '\n'}<mark ref={marked} aria-label={`已定位第 ${range.startLine} 至 ${range.endLine} 行`} className="bg-[#394c76] text-white [box-decoration-break:clone]">{lines.slice(range.startLine - 1, range.endLine).join('\n')}</mark>{range.endLine < lines.length && '\n'}{lines.slice(range.endLine).join('\n')}</> : text;
  return <section aria-label={label} aria-busy={loading} className={cx('min-w-0 overflow-hidden rounded-lg bg-nav', fill && 'flex min-h-0 flex-1 flex-col', className)}>
    {(title || copyable) && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#262b33] px-4 py-2.5">
      <span className="font-mono text-[12.5px] text-nav-text">{title}</span>
      {copyable && <CopyButton text={text} size="sm" variant="ghost" className="text-nav-text hover:bg-nav-hover" />}
    </div>}
    <pre ref={body} tabIndex={0} className={cx('m-0 overflow-auto p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7] transition-opacity', fill ? 'min-h-0 flex-1' : 'max-h-[420px]', loading && 'opacity-70', bodyClassName)}>{lineNumbers ? <span className="flex min-w-max"><span aria-hidden="true" className="sticky left-0 mr-3 select-none border-r border-[#343a44] bg-nav pr-3 text-right text-[#8b95a5]">{lines.map((_, i) => i + 1).join('\n')}</span><code>{content}</code></span> : content}</pre>
  </section>;
}
