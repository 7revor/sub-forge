import type { ReactNode } from 'react';
import { cx } from './cx.ts';

/** 全站空状态；紧凑尺寸仅供下拉候选弹层使用，外部间距由容器负责。 */
export function Empty({ title, description, action, children, className, size = 'default', variant = 'plain' }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode;
  className?: string; size?: 'default' | 'compact'; variant?: 'panel' | 'plain';
}) {
  return <div className={cx(
    'flex min-w-0 shrink-0 flex-col items-center gap-2 text-center [overflow-wrap:anywhere]',
    variant === 'panel' && 'rounded-xl border border-dashed border-control-line bg-panel',
    size === 'compact' ? 'p-3' : variant === 'panel' ? 'px-7 py-10' : 'px-4 py-4', className,
  )}>
    {title && <div className={cx('max-w-full font-normal leading-relaxed text-ink-muted', size === 'compact' ? 'text-[length:var(--text-control)]' : 'text-[length:var(--text-body)]')}>{title}</div>}
    {description && <div className="max-w-[420px] text-[length:var(--text-control)] leading-relaxed text-ink-muted">{description}</div>}
    {children && <div className="max-w-full text-[length:var(--text-control)] leading-relaxed text-ink-muted">{children}</div>}
    {action && <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">{action}</div>}
  </div>;
}
