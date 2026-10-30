import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpToLine, LockKeyhole } from 'lucide-react';
import { SortableList } from './SortableList.tsx';
import { Button } from './ui.tsx';

export type TemplateListItem<T> = { kind: 'custom'; item: T } | { kind: 'template'; items: T[] };

/** 模板在排序数据中始终只占一个位置，不能把自定义项插进模板内部。 */
export function templateListItems<T extends { id: string }>(items: T[], templateIds: string[], templateStart: number): TemplateListItem<T>[] {
  const ids = new Set(templateIds);
  const custom = items.filter(item => !ids.has(item.id));
  return [...custom.slice(0, templateStart).map(item => ({ kind: 'custom' as const, item })), { kind: 'template', items: items.filter(item => ids.has(item.id)) }, ...custom.slice(templateStart).map(item => ({ kind: 'custom' as const, item }))];
}
export function flattenTemplateItems<T>(items: TemplateListItem<T>[]) {
  return { items: items.flatMap(row => row.kind === 'template' ? row.items : [row.item]), templateStart: items.findIndex(row => row.kind === 'template') };
}

export function TemplateBoundList<T extends { id: string }>({ items, templateIds, templateStart = 0, onReorder, renderItem, isLocked, canDrop, label }: {
  items: T[]; templateIds?: string[]; templateStart?: number; label: string;
  onReorder: (items: T[], templateStart?: number) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  isLocked?: (item: T) => boolean; canDrop?: (from: number, to: number) => boolean;
}) {
  if (!templateIds) return <SortableList items={items} getKey={item => item.id} isLocked={isLocked} canDrop={canDrop} onReorder={next => onReorder(next)} renderItem={renderItem} />;
  const rows = templateListItems(items, templateIds, templateStart);
  const reorder = (next: TemplateListItem<T>[]) => { const result = flattenTemplateItems(next); onReorder(result.items, result.templateStart); };
  return <SortableList items={rows} getKey={row => row.kind === 'template' ? 'template:block' : `custom:${row.item.id}`} isLocked={row => row.kind === 'template'} onReorder={reorder} renderItem={(row, index, handle) => {
    if (row.kind === 'template') return <section aria-label={`模板${label}整体`} className="my-3 rounded-lg border border-dashed border-line bg-ground p-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-muted"><LockKeyhole size={14} />模板{label} · {row.items.length} 项 · 整体跟随模板</div>
      {row.items.map(item => <div key={item.id}>{renderItem(item, items.indexOf(item), <span className="grid h-8 w-6 place-items-center text-ink-muted" aria-label="跟随模板"><LockKeyhole size={16} /></span>)}</div>)}
      {!row.items.length && <p className="m-0 text-[13px] text-ink-muted">模板暂无{label}，自定义项仍保留前后位置。</p>}
    </section>;
    const move = (before: boolean) => {
      const next = rows.filter((_, i) => i !== index);
      next.splice(before ? 0 : next.length, 0, row);
      reorder(next);
    };
    return <div className="my-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 pt-1 [&_[data-routing-card]]:border-emerald-500/25 [&_[data-routing-card]]:bg-transparent">
      <div className="flex items-center justify-between gap-2 pl-2 text-[12px] text-emerald-700 dark:text-emerald-300"><span>自定义 · {index < templateStart ? '模板之前' : '模板之后'}</span><div className="flex gap-1">
        <Button variant="ghost" size="sm" aria-label={`将自定义${label}第 ${items.indexOf(row.item) + 1} 项移到最上方`} disabled={index === 0} onClick={() => move(true)}><ArrowUpToLine size={13} />最上方</Button>
        <Button variant="ghost" size="sm" aria-label={`将自定义${label}第 ${items.indexOf(row.item) + 1} 项移到最下方`} disabled={index === rows.length - 1} onClick={() => move(false)}><ArrowDownToLine size={13} />最下方</Button>
      </div></div>
      {renderItem(row.item, items.indexOf(row.item), handle)}
    </div>;
  }} />;
}
