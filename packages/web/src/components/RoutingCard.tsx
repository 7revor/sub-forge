import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, cx } from './ui.tsx';

/** 策略组、规则和增强来源共用尺寸，保留各自的信息排列。 */
export function RoutingCard({ children, className, invalid, id }: { children: ReactNode; className?: string; invalid?: boolean; id?: string }) {
  return <div id={id} data-routing-card className={cx('my-2 min-h-[50px] items-center gap-x-2 gap-y-2 rounded-lg border bg-panel px-4 py-2 text-[13px] leading-5', invalid ? 'border-err' : 'border-line', className)}>{children}</div>;
}

export function RoutingCardIcon({ children }: { children: ReactNode }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink [&>svg]:size-4" aria-hidden>{children}</span>;
}

export function RoutingCardActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete?: () => void }) {
  return <div className="ml-auto flex shrink-0 justify-end gap-1">
    <Button size="sm" variant="ghost" className="px-1.5" title={`编辑${label}`} aria-label={`编辑${label}`} onClick={onEdit}><Pencil size={14} /></Button>
    {onDelete && <Button size="sm" variant="ghost" className="px-1.5 hover:text-err" title={`删除${label}`} aria-label={`删除${label}`} onClick={onDelete}><Trash2 size={14} /></Button>}
  </div>;
}
