// 文档列表：服务端搜索与分页，搜索栏和分页器固定，表格占满剩余高度并独立滚动。
// 空列表保留分页和搜索；每行操作为「删除」「编辑」，删除先弹确认。

import { usePagedList } from '../hooks/usePagedList.ts';
import { Pagination } from './Pagination.tsx';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useDeleteDoc, type DocMap, type Kind } from '../hooks.ts';
import { Button, buttonClass, cx, Empty, ErrorAlert, Input, PageHeader, td, th } from './ui.tsx';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from './DocTableRow.tsx';
import { DeleteDialog } from './DetailActions.tsx';

export type Column<K extends Kind> = { header: string; cell: (d: DocMap[K]) => ReactNode; className?: string };

export function DocList<K extends Kind>({ kind, title, columns, intro, canCreate = true, noun, onCreate, empty, deleteBody }: {
  kind: K; title: string; columns: Column<K>[]; intro?: ReactNode; canCreate?: boolean;
  /** 「新建 X」「搜索 X」里的对象名，默认用标题 */
  noun?: string;
  /** 提供时「新建」打开对话框，否则跳转到 /kind/new */
  onCreate?: () => void;
  /** 空列表卡片里的说明 */
  empty?: ReactNode;
  /** 删除确认对话框里的说明，与详情页一致 */
  deleteBody?: ReactNode;
}) {
  const list = usePagedList(kind);
  const del = useDeleteDoc(kind);
  const [deleting, setDeleting] = useState<DocMap[K]>();
  const { q, setQ } = list;
  const name = noun ?? title;
  const createButton = (size: 'sm' | 'md', variant: 'primary' | 'default') => onCreate
    ? <Button variant={variant} size={size} onClick={onCreate}>{size === 'md' && <Plus size={16} />}新建{name}</Button>
    : <Link to={`/${kind}/new`} className={buttonClass(variant, size)}>{size === 'md' && <Plus size={16} />}新建{name}</Link>;
  const rows = list.data?.items ?? [];
  return (
    <>
      <PageHeader title={title} subtitle={intro} actions={canCreate && createButton('md', 'primary')} />
      <ErrorAlert error={list.error} />
      <section className="list-panel" aria-busy={list.isFetching}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <Input aria-label={`搜索${name}`} placeholder="搜索名称" className="max-w-[280px]" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.isFetching && <span className="text-[12.5px] text-muted">加载中…</span>}
        </div>
        <div key={`${list.data?.page}-${list.pageSize}-${q}`} className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {!list.data ? <div className="p-4 text-muted">{list.error ? '列表加载失败，请重试。' : '加载中…'}{list.error && <Button size="sm" onClick={() => void list.refetch()}>重试</Button>}</div> : !rows.length ? (
            <div className="p-4"><Empty title={q.trim() ? `没有名称包含「${q.trim()}」的${name}` : `还没有${name}`} description={!q.trim() && empty} action={!q.trim() && canCreate && createButton('sm', 'default')} /></div>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>{columns.map((c) => <th key={c.header} className={cx(th, 'px-3.5')}>{c.header}</th>)}<th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <DocTableRow key={d.id} to={`/${kind}/${d.id}`}>
                    {columns.map((c, i) => (
                      <td key={c.header} className={cx(td, 'px-3.5 py-3 whitespace-nowrap', c.className)}>
                        {i === 0 ? <Link to={`/${kind}/${d.id}`} className={docNameLinkClass}>{c.cell(d)}</Link> : c.cell(d)}
                      </td>
                    ))}
                    <td className={cx(td, 'text-right whitespace-nowrap')}>
                      <Button size="sm" variant="danger" aria-label={`删除 ${d.name}`} className="mr-2" onClick={() => { del.reset(); setDeleting(d); }}>删除</Button>
                      <DocActionLink to={`/${kind}/${d.id}`} name={d.name} />
                    </td>
                  </DocTableRow>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={list.data?.page ?? list.page} pageSize={list.pageSize} total={list.data?.total ?? 0} totalPages={list.data?.totalPages ?? 1}
          busy={list.isFetching || !list.data} onPage={list.setPage} onPageSize={list.setPageSize} />
      </section>
      <DeleteDialog open={!!deleting} title={`删除${name}「${deleting?.name ?? ''}」？`} error={del.error} pending={del.isPending}
        onClose={() => setDeleting(undefined)} onConfirm={() => { if (deleting) del.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) }); }}>
        {deleteBody ?? '删除后无法恢复。'}
      </DeleteDialog>
    </>
  );
}
