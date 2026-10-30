import type { ReactNode } from 'react';
import { cx } from './cx.ts';

/** 全站空状态；紧凑尺寸仅供下拉候选弹层使用，外部间距由容器负责。 */
export function Empty({ title, description, action, children, className, size = 'default' }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode;
  className?: string; size?: 'default' | 'compact';
}) {
  return <div className={cx(
    'flex min-w-0 shrink-0 flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel text-center [overflow-wrap:anywhere]',
    size === 'compact' ? 'p-3' : 'px-7 py-7', className,
  )}>
    {title && <div className={cx('max-w-full font-semibold leading-relaxed text-ink', size === 'compact' ? 'text-[12.5px]' : 'text-[14px]')}>{title}</div>}
    {description && <div className="max-w-[420px] text-[12.5px] leading-relaxed text-ink-muted">{description}</div>}
    {children && <div className="max-w-full text-[12.5px] leading-relaxed text-ink-muted">{children}</div>}
    {action && <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">{action}</div>}
  </div>;
}
