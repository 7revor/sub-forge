import type { ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { SortableList } from './SortableList.tsx';

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
  return <SortableList items={rows} getKey={row => row.kind === 'template' ? 'template:block' : `custom:${row.item.id}`} isLocked={row => row.kind === 'template'} onReorder={reorder} renderItem={(row, _index, handle) => {
    if (row.kind === 'template') return <section aria-label={`模板${label}整体`} className="my-3 rounded-lg border border-dashed border-line bg-ground p-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-muted"><LockKeyhole size={14} />模板{label} · {row.items.length} 项</div>
      {row.items.map(item => <div key={item.id}>{renderItem(item, items.indexOf(item), <span className="grid h-8 w-6 place-items-center text-ink-muted" aria-label="跟随模板"><LockKeyhole size={16} /></span>)}</div>)}
      {!row.items.length && <p className="m-0 text-[13px] text-ink-muted">模板暂无{label}。</p>}
    </section>;
    return <div className="[&_[data-routing-card]]:border-emerald-500/30 [&_[data-routing-card]]:bg-emerald-500/5">
      {renderItem(row.item, items.indexOf(row.item), handle)}
    </div>;
  }} />;
}
