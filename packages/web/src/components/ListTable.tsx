import type { ReactNode } from 'react';
import { cx, listTd, listTh } from './ui.tsx';

export type ListTableColumn = { header: ReactNode; width: number };

/** 列宽按设计比例分配；窄屏由表格容器独立横向滚动，异步内容不参与列宽计算。 */
export function ListTable({ label, columns, children }: { label: string; columns: ListTableColumn[]; children: ReactNode }) {
  return <table aria-label={label} className="list-table" >
    <colgroup>{columns.map((column, index) => <col key={index} style={{ width: `${column.width / columns.reduce((sum, c) => sum + c.width, 0) * 100}%` }} />)}</colgroup>
    <thead><tr>{columns.map((column, index) => <th key={index} scope="col" className={listTh}>{column.header}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table>;
}

/** 占位行与真实行使用同一套列宽，读屏仅播报一次加载状态。 */
export function ListTableLoading({ columns, rows = 6, rowHeight = 57 }: { columns: number; rows?: number; rowHeight?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => <tr key={row} style={{ height: rowHeight }}>
    {Array.from({ length: columns }, (_, column) => <td key={column} className={listTd}>
      {row === 0 && column === 0 && <span role="status" className="sr-only">正在加载列表…</span>}
      <span aria-hidden="true" className={cx('block h-3 rounded bg-line-2 motion-safe:animate-pulse', column === columns - 1 ? 'ml-auto w-3/4' : row % 2 ? 'w-2/3' : 'w-4/5')} />
    </td>)}
  </tr>)}</>;
}
