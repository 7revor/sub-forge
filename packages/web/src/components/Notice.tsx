import type { ReactNode } from 'react';
import { cx } from './cx.ts';

const tones = { warn: 'bg-warn-soft text-warn', err: 'bg-err-soft text-err', accent: 'bg-accent-soft text-accent-ink', ok: 'bg-ok-soft text-ok' };
export function Notice({ children, actions, tone = 'warn', className }: { children: ReactNode; actions?: ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <div role={tone === 'err' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-[length:var(--text-control)]', tones[tone], className)}>
    <div className="min-w-0">{children}</div>{actions}
  </div>;
}
