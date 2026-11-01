import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cx } from './cx.ts';

const tones = { warn: 'bg-warn-soft text-warn', err: 'bg-err-soft text-err', accent: 'bg-accent-soft text-accent-ink', ok: 'bg-ok-soft text-ok' };
const icons = { warn: TriangleAlert, err: CircleAlert, accent: Info, ok: CircleCheck };

/** 页内横幅：语义色浅底 + 图标 + 一句说明，操作放在右侧。 */
export function Notice({ children, actions, tone = 'warn', className }: { children: ReactNode; actions?: ReactNode; tone?: keyof typeof tones; className?: string }) {
  const Icon = icons[tone];
  return <div role={tone === 'err' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-[length:var(--text-control)]', tones[tone], className)}>
    <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 leading-5">{children}</div>{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>;
}
