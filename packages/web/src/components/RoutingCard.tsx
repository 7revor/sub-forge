import { ActionMenu } from './ActionMenu.tsx';
import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, cx } from './ui.tsx';

/** 策略组、规则和增强来源共用尺寸，保留各自的信息排列。 */
export function RoutingCard({ children, className, invalid, id }: { children: ReactNode; className?: string; invalid?: boolean; id?: string }) {
  return <div id={id} data-routing-card className={cx('my-2 min-h-[52px] items-center gap-x-3 gap-y-2 rounded-[10px] border bg-panel px-4 py-2 text-[length:var(--text-control)] leading-5', invalid ? 'border-err' : 'border-line', className)}>{children}</div>;
}

export function RoutingCardIcon({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4", muted ? "bg-neutral-soft text-ink-muted" : "bg-accent-soft text-accent-ink")} aria-hidden>{children}</span>;
}

export function RoutingCardActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete?: () => void }) {
  return <div className="ml-auto flex shrink-0 justify-end gap-1">
    <Button size="sm" variant="ghost" className="px-1.5" title={`编辑${label}`} aria-label={`编辑${label}`} onClick={onEdit}><Pencil size={14} /></Button>
    {onDelete && <ActionMenu label={`${label}更多操作`} items={[{ label: `删除${label}`, onSelect: onDelete, danger: true }]} />}
  </div>;
}
