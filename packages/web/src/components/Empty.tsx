import type { ReactNode } from 'react';
import { cx } from './cx.ts';

/** 全站空状态；panel 用于页面级，card 用于面板内卡片行列表（与 RoutingCard 同尺寸），紧凑尺寸仅供下拉候选弹层使用，外部间距由容器负责。 */
export function Empty({ title, description, action, children, className, size = 'default', variant = 'plain' }: {
  title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode;
  className?: string; size?: 'default' | 'compact'; variant?: 'panel' | 'card' | 'plain';
}) {
  const text = variant === 'card' ? 'text-xs leading-[18px]' : 'text-sm leading-relaxed';
  return <div className={cx(
    'flex min-w-0 shrink-0 flex-col items-center gap-2 text-center [overflow-wrap:anywhere]',
    variant === 'panel' && 'rounded-xl border border-dashed border-input bg-card',
    variant === 'card' && 'min-h-[52px] justify-center rounded-lg border border-dashed border-input',
    size === 'compact' ? 'p-3' : variant === 'panel' ? 'px-7 py-10' : variant === 'card' ? 'px-4 py-3.5' : 'px-4 py-4', className,
  )}>
    {title && <div className={cx('max-w-full font-normal text-muted-foreground', text)}>{title}</div>}
    {description && <div className={cx('max-w-[420px] text-muted-foreground', text)}>{description}</div>}
    {children && <div className={cx('max-w-full text-muted-foreground', text)}>{children}</div>}
    {action && <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">{action}</div>}
  </div>;
}
