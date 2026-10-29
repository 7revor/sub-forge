import type { ReactNode } from 'react';
import { cx } from './cx.ts';

const tones = { warn: 'bg-warn-soft text-[#6b3406]', err: 'bg-err-soft text-[#8f2a1f]', accent: 'bg-accent-soft text-accent-ink', ok: 'bg-ok-soft text-[#17633a]' };
export function Notice({ children, actions, tone = 'warn', className }: { children: ReactNode; actions?: ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <div role={tone === 'err' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-[13px]', tones[tone], className)}>
    <div className="min-w-0">{children}</div>{actions}
  </div>;
}
