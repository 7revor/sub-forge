import type { ReactNode } from 'react';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from './RoutingCard.tsx';

const targetClass = 'w-[112px] min-w-0 shrink-0';

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
      {target && <div className={targetClass}>{target}</div>}
    </div>
    {!readOnly && <div className="col-start-3 row-start-1 ml-auto"><RoutingCardActions label={label} onEdit={onEdit} onDelete={onDelete} /></div>}
    {readOnly && <span className="col-start-3 row-start-1 w-[60px] shrink-0 text-right text-[12px] text-ink-muted">跟随模板</span>}
  </RoutingCard>;
}

/** MATCH 沿用规则行的拖动、图标、出口及操作栏占位，保持对应列对齐。 */
export function RuleCardFooter({ children, target, targetId }: { children: ReactNode; target: ReactNode; targetId: string }) {
  return <div className="grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_60px] items-center gap-x-2 gap-y-2 border-x border-transparent py-2 pr-3 pl-2 text-[13px] leading-5 sm:flex">
    <span className="w-6 shrink-0" aria-hidden />
    <span className="col-span-2 min-w-0 pl-10 sm:flex-1"><span>{children}</span></span>
    <div className="col-span-2 col-start-2 row-start-2 flex justify-end sm:contents"><div id={targetId} className={targetClass}>{target}</div></div>
    <span className="hidden w-[60px] shrink-0 sm:block" aria-hidden />
  </div>;
}
