import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES } from '../hooks/usePagedList.ts';
import { Button, cx } from './ui.tsx';
import { Select } from './listbox.tsx';

/** 控件与表格行内按钮同为 32px，左右内边距与表格首尾列对齐。 */
export function Pagination({ page, pageSize, total, totalPages, busy, unknownTotal = false, className, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; totalPages: number; busy?: boolean; unknownTotal?: boolean; className?: string;
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  return <nav aria-label="列表分页" className={cx('flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-6 py-2.5', className)}>
    <span aria-live="polite" className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">共 {unknownTotal ? '—' : total} 条</span>
    <div className="flex flex-wrap items-center gap-2">
      <Select size="sm" placeholder="选择每页显示的记录数量" aria-label="每页条数" className="w-fit border-transparent bg-transparent shadow-none hover:bg-accent dark:bg-transparent" value={pageSize} disabled={busy} onChange={e => onPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map(size => <option key={size} value={size}>{size} 条 / 页</option>)}
      </Select>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="上一页" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        <span className="min-w-[40px] text-center whitespace-nowrap text-sm tabular-nums text-muted-foreground">{page} / {unknownTotal ? '—' : totalPages}</span>
        <Button size="icon-sm" variant="ghost" aria-label="下一页" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  </nav>;
}
