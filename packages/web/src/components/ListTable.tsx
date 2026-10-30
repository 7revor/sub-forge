import type { ReactNode } from 'react';
import { cx, td, th } from './ui.tsx';

export type ListTableColumn = { header: ReactNode; width: number };

/** 首列吸收剩余空间，其他列按约定宽度展示；异步内容不参与列宽计算。 */
export function ListTable({ label, columns, children }: { label: string; columns: ListTableColumn[]; children: ReactNode }) {
  return <table aria-label={label} className="list-table" style={{ minWidth: columns.reduce((sum, column) => sum + column.width, 0) }}>
    <colgroup>{columns.map((column, index) => <col key={index} style={index ? { width: column.width } : undefined} />)}</colgroup>
    <thead><tr>{columns.map((column, index) => <th key={index} scope="col" className={th}>{column.header}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table>;
}

/** 占位行与真实行使用同一套列宽，读屏仅播报一次加载状态。 */
export function ListTableLoading({ columns, rows = 6, rowHeight = 53 }: { columns: number; rows?: number; rowHeight?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => <tr key={row} style={{ height: rowHeight }}>
    {Array.from({ length: columns }, (_, column) => <td key={column} className={td}>
      {row === 0 && column === 0 && <span role="status" className="sr-only">正在加载列表…</span>}
      <span aria-hidden="true" className={cx('block h-3 rounded bg-line-2 motion-safe:animate-pulse', column === columns - 1 ? 'ml-auto w-3/4' : row % 2 ? 'w-2/3' : 'w-4/5')} />
    </td>)}
  </tr>)}</>;
}
