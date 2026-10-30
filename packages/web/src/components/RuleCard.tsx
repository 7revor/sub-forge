import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, cx } from './ui.tsx';

/** 规则增强、模板与订阅共用：正文预览，铅笔编辑，操作不会触发预览。 */
export function RuleCard({ handle, icon, children, count, hint, target, readOnly, invalid, onPreview, onEdit, onDelete, label, id }: {
  handle: ReactNode; icon: ReactNode; children: ReactNode; count?: ReactNode; hint?: ReactNode; target?: ReactNode;
  readOnly?: boolean; invalid?: boolean; onPreview: () => void; onEdit: () => void; onDelete: () => void; label: string; id?: string;
}) {
  return <div id={id} className={cx('my-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-panel py-2.5 pr-3 pl-2', invalid ? 'border-err' : 'border-line')}>
    {handle}
    <button type="button" aria-label={`预览${label}`} onClick={onPreview} className="flex min-w-0 flex-[1_1_220px] cursor-pointer items-center gap-2.5 text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink" aria-hidden>{icon}</span>
      <span className="min-w-0 truncate text-[13.5px] font-medium">{children}</span>
    </button>
    {hint}{count}
    {target && <div className="order-last ml-9 w-full min-w-0 sm:order-none sm:ml-0 sm:w-[136px]">{target}</div>}
    {!readOnly && <div className="ml-auto flex shrink-0 gap-1">
      <Button variant="ghost" className="w-10 px-0!" title={`编辑${label}`} aria-label={`编辑${label}`} onClick={onEdit}><Pencil size={18} className="shrink-0" /></Button>
      <Button variant="ghost" className="w-10 px-0! hover:text-err" title={`删除${label}`} aria-label={`删除${label}`} onClick={onDelete}><Trash2 size={18} className="shrink-0" /></Button>
    </div>}
    {readOnly && <span className="text-[12px] text-ink-muted">跟随模板</span>}
  </div>;
}
