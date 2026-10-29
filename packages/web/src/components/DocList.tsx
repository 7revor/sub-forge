// 文档列表页的通用骨架：标题、新建按钮、表格。

import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useList, type DocMap, type Kind } from '../hooks.ts';
import { Card, Empty, ErrorBox, PageHeader, td, th } from './ui.tsx';
import { DocActionLink, DocTableRow, docNameLinkClass } from './DocTableRow.tsx';

export type Column<K extends Kind> = { header: string; cell: (d: DocMap[K]) => ReactNode; className?: string };

export function DocList<K extends Kind>({ kind, title, columns, intro, canCreate = true }: { kind: K; title: string; columns: Column<K>[]; intro?: ReactNode; canCreate?: boolean }) {
  const list = useList(kind);
  return (
    <>
      <PageHeader
        title={title}
        actions={canCreate && <Link to={`/${kind}/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-white no-underline hover:bg-accent-strong"><Plus size={16} />新建</Link>}
      />
      {intro && <p className="m-0 -mt-2 text-[13.5px] text-muted">{intro}</p>}
      <ErrorBox error={list.error} />
      <Card bodyClass="overflow-x-auto">
        {list.isLoading ? <div className="p-4 text-muted">加载中…</div> : !list.data?.length ? <div className="p-4"><Empty>还没有内容。</Empty></div> : (
          <table className="w-full border-collapse">
            <thead><tr>{columns.map((c) => <th key={c.header} className={th}>{c.header}</th>)}<th className={`${th} w-px text-right`}>操作</th></tr></thead>
            <tbody>
              {list.data.map((d) => (
                <DocTableRow key={d.id} to={`/${kind}/${d.id}`}>
                  {columns.map((c, i) => (
                    <td key={c.header} className={`${td} ${c.className ?? ''}`}>
                      {i === 0 ? <Link to={`/${kind}/${d.id}`} className={docNameLinkClass}>{c.cell(d)}</Link> : c.cell(d)}
                    </td>
                  ))}
                  <td className={`${td} text-right`}><DocActionLink to={`/${kind}/${d.id}`} name={d.name} /></td>
                </DocTableRow>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/** 详情页底部的删除按钮：被引用时展示引用方 */
export function deleteErrorText(err: unknown): string | undefined {
  if (!err) return undefined;
  const e = err as { message?: string; details?: { referrers?: string[] } };
  return e.details?.referrers ? `${e.message}：${e.details.referrers.join('、')}` : e.message;
}
