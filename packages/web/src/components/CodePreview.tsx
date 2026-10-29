import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton.tsx';
import { cx } from './cx.ts';

/** 只负责只读文本展示；请求、错误与空结果语义由使用方决定。 */
export function CodePreview({ text, title, label, copyable = false, loading = false, lineNumbers = false, className, bodyClassName }: {
  lineNumbers?: boolean; text: string; title?: ReactNode; label?: string; copyable?: boolean; loading?: boolean; className?: string; bodyClassName?: string;
}) {
  return <section aria-label={label} aria-busy={loading} className={cx('min-w-0 overflow-hidden rounded-lg bg-nav', className)}>
    {(title || copyable) && <div className="flex items-center justify-between gap-2 border-b border-[#262b33] px-4 py-2.5">
      <span className="font-mono text-[12.5px] text-nav-text">{title}</span>
      {copyable && <CopyButton text={text} size="sm" variant="ghost" className="text-nav-text hover:bg-nav-hover" />}
    </div>}
    <pre className={cx('m-0 max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7] transition-opacity', loading && 'opacity-70', bodyClassName)}>{lineNumbers ? <span className="flex min-w-max"><span aria-hidden="true" className="sticky left-0 mr-3 select-none border-r border-[#343a44] bg-nav pr-3 text-right text-[#8b95a5]">{text.split('\n').map((_, i) => i + 1).join('\n')}</span><code>{text}</code></span> : text}</pre>
  </section>;
}
