import { PAGE_SIZES } from '../hooks/usePagedList.ts';
import { Button } from './ui.tsx';
import { Select } from './listbox.tsx';

export function Pagination({ page, pageSize, total, totalPages, busy, compact = false, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; totalPages: number; busy?: boolean; compact?: boolean;
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  return <nav aria-label="列表分页" className={`shrink-0 items-center gap-3 border-t border-line px-4 py-3 ${compact ? 'grid grid-cols-[1fr_auto]' : 'flex flex-wrap justify-between'}`}>
    <span aria-live="polite" className="text-[12.5px] text-ink-muted">共 {total} 条{total > 0 && ` · 第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条`}</span>
    <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-2'}>
      <Select aria-label="每页条数" className="w-[112px]" value={pageSize} disabled={busy} onChange={e => onPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size} 条 / 页</option>)}
      </Select>
      <div className={`flex items-center gap-2 ${compact ? 'col-span-2 justify-between' : ''}`}>
        <Button size="sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
        <span className="whitespace-nowrap text-[12.5px] text-ink-muted">第 {page} / {totalPages} 页</span>
        <Button size="sm" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>下一页</Button>
      </div>
    </div>
  </nav>;
}
