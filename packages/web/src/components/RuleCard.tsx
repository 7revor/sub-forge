import type { ReactNode } from 'react';
import { CornerDownRight, LockKeyhole } from 'lucide-react';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from './RoutingCard.tsx';

const targetClass = 'w-[112px] min-w-0 shrink-0';
const layoutClass = 'grid grid-cols-[24px_minmax(0,1fr)_60px] sm:flex sm:flex-wrap';
const contentClass = 'flex min-w-0 items-center gap-2 text-left sm:flex-[1_1_160px]';

/** 规则增强、模板与订阅共用：正文预览，铅笔编辑，操作不会触发预览。 */
export function RuleCard({ handle, icon, children, count, hint, target, readOnly, invalid, onPreview, onEdit, onDelete, label, id }: {
  handle: ReactNode; icon: ReactNode; children: ReactNode; count?: ReactNode; hint?: ReactNode; target?: ReactNode;
  readOnly?: boolean; invalid?: boolean; onPreview: () => void; onEdit: () => void; onDelete: () => void; label: string; id?: string;
}) {
  return <RoutingCard id={id} invalid={invalid} className={layoutClass}>
    {handle}
    <button type="button" aria-label={`预览${label}`} onClick={onPreview} className={`cursor-pointer rounded-lg ${contentClass}`}>
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

/** MATCH 固定在排序列表之后，共用规则卡片尺寸，仅允许修改出口。 */
export function RuleFinalCard({ target, targetId, readOnly }: { target: ReactNode; targetId: string; readOnly?: boolean }) {
  return <RoutingCard className={layoutClass}>
    <span role="img" aria-label="MATCH 固定在末尾" title="固定在末尾" className="grid h-8 w-6 shrink-0 place-items-center text-faint"><LockKeyhole size={16} /></span>
    <div className={contentClass}><RoutingCardIcon><CornerDownRight size={16} /></RoutingCardIcon><span className="font-medium">MATCH</span></div>
    <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 justify-end sm:contents"><div id={targetId} className={targetClass}>{target}</div></div>
    {readOnly ? <span className="col-start-3 row-start-1 w-[60px] shrink-0 text-right text-[12px] text-ink-muted">跟随模板</span> : <span className="col-start-3 row-start-1 w-[60px] shrink-0" aria-hidden />}
  </RoutingCard>;
}
