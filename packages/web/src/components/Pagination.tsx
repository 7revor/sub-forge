import { PAGE_SIZES } from '../hooks/usePagedList.ts';
import { Button } from './ui.tsx';
import { Select } from './listbox.tsx';

export function Pagination({ page, pageSize, total, totalPages, busy, unknownTotal = false, compact = false, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; totalPages: number; busy?: boolean; unknownTotal?: boolean; compact?: boolean;
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  return <nav aria-label="列表分页" className={`list-pagination shrink-0 items-center gap-3 table-panel-divider px-5 py-2.5 ${compact ? 'grid grid-cols-[1fr_auto]' : 'flex flex-wrap justify-between'}`}>
    <span aria-live="polite" className="min-w-0 whitespace-nowrap text-[length:var(--text-control)] tabular-nums text-ink-muted">{unknownTotal ? '共 — 条 · 第 — 条' : <>共 {total} 条{total > 0 && ` · 第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条`}</>}</span>
    <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-2'}>
      <Select placeholder="选择每页显示的记录数量" aria-label="每页条数" className="w-[112px]" style={{height:28}} value={pageSize} disabled={busy} onChange={e => onPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size} 条 / 页</option>)}
      </Select>
      <div className={`flex items-center gap-2 ${compact ? 'col-span-2 justify-between' : ''}`}>
        <Button size="sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
        <span className="min-w-[40px] text-center whitespace-nowrap text-[length:var(--text-control)] tabular-nums text-ink-muted">{page} / {unknownTotal ? '—' : totalPages}</span>
        <Button size="sm" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>下一页</Button>
      </div>
    </div>
  </nav>;
}
