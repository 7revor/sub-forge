import type { ReactNode } from 'react';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from './RoutingCard.tsx';

/** 规则增强、模板与订阅共用：正文预览，铅笔编辑，操作不会触发预览。 */
export function RuleCard({ handle, icon, children, count, hint, target, readOnly, invalid, onPreview, onEdit, onDelete, label, id }: {
  handle: ReactNode; icon: ReactNode; children: ReactNode; count?: ReactNode; hint?: ReactNode; target?: ReactNode;
  readOnly?: boolean; invalid?: boolean; onPreview: () => void; onEdit: () => void; onDelete: () => void; label: string; id?: string;
}) {
  return <RoutingCard id={id} invalid={invalid} className="grid grid-cols-[24px_minmax(0,1fr)_auto] sm:flex sm:flex-wrap">
    {handle}
    <button type="button" aria-label={`预览${label}`} onClick={onPreview} className="flex min-w-0 cursor-pointer items-center gap-2 text-left sm:flex-[1_1_160px]">
      <RoutingCardIcon>{icon}</RoutingCardIcon>
      <span className="min-w-0 truncate font-medium">{children}</span>
    </button>
    <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center justify-end gap-2 empty:hidden sm:contents">
      {hint}{count}
      {target && <div className="w-[136px] min-w-0">{target}</div>}
    </div>
    {!readOnly && <div className="col-start-3 row-start-1 ml-auto"><RoutingCardActions label={label} onEdit={onEdit} onDelete={onDelete} /></div>}
    {readOnly && <span className="col-start-3 row-start-1 text-[12px] text-ink-muted">跟随模板</span>}
  </RoutingCard>;
}
