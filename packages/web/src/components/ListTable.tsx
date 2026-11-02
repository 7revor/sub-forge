import type { ReactNode } from 'react';
import { cx } from './ui.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

export type ListTableColumn = { header: ReactNode; width: number };

/** 列宽按设计比例分配；窄屏由表格容器独立横向滚动，异步内容不参与列宽计算。 */
export function ListTable({ label, columns, children }: { label: string; columns: ListTableColumn[]; children: ReactNode }) {
  return <Table aria-label={label} className="list-table" containerClassName="overflow-visible">
    <colgroup>{columns.map((column, index) => <col key={index} style={{ width: `${column.width / columns.reduce((sum, c) => sum + c.width, 0) * 100}%` }} />)}</colgroup>
    <TableHeader><TableRow>{columns.map((column, index) => <TableHead key={index} scope="col">{column.header}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{children}</TableBody>
  </Table>;
}

/** 占位行与真实行使用同一套列宽，读屏仅播报一次加载状态。 */
export function ListTableLoading({ columns, rows = 6, rowHeight = 57 }: { columns: number; rows?: number; rowHeight?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => <TableRow key={row} className="hover:bg-transparent" style={{ height: rowHeight }}>
    {Array.from({ length: columns }, (_, column) => <TableCell key={column}>
      {row === 0 && column === 0 && <span role="status" className="sr-only">正在加载列表…</span>}
      <span aria-hidden="true" className={cx('block h-3 rounded bg-border motion-safe:animate-pulse', column === columns - 1 ? 'ml-auto w-3/4' : row % 2 ? 'w-2/3' : 'w-4/5')} />
    </TableCell>)}
  </TableRow>)}</>;
}
