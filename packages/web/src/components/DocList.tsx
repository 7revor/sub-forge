import { RefreshCacheButton, ResourceCacheStatus, ResourceLastRefreshTime } from './ResourceCache.tsx';
// 文档列表：服务端搜索与分页，搜索栏和分页器固定，表格占满剩余高度并独立滚动。
// 空列表保留分页和搜索；每行操作为「删除」「编辑」，删除先弹确认。

import { usePagedList } from '../hooks/usePagedList.ts';
import { Pagination } from './Pagination.tsx';
import { Plus } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { useDeleteDoc, type DocMap, type Kind } from '../hooks.ts';
import { Button, buttonClass, cx, Empty, ErrorAlert, Input, PageHeader, td, th } from './ui.tsx';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from './DocTableRow.tsx';
import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from './ResourceLinkButton.tsx';

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
  deleteBody?: string;
}) {
  const list = usePagedList(kind);
  const del = useDeleteDoc(kind);
  const { q, setQ } = list;
  const name = noun ?? title;
  const createButton = (size: 'sm' | 'md', variant: 'primary' | 'default') => onCreate
    ? <Button variant={variant} size={size} onClick={onCreate}>{size === 'md' && <Plus size={16} />}新建{name}</Button>
    : <Link to={`/${kind}/new`} className={buttonClass(variant, size)}>{size === 'md' && <Plus size={16} />}新建{name}</Link>;
  const rows = list.data?.items ?? [];
  const canWrite = (id: string) => kind !== 'rulesets' || list.data?.writableIds?.includes(id) === true;
  const refreshable=['sources','collections','rulesets','profiles'].includes(kind);
  const canRefresh=(d:DocMap[K])=>kind!=='rulesets'||(d as DocMap['rulesets']).sources.some(s=>s.kind==='remote'&&s.enabled!==false);
  return (
    <>
      <PageHeader title={title} subtitle={intro} actions={canCreate && createButton('md', 'primary')} />
      <ErrorAlert error={list.error} />
      <section className="list-panel" aria-busy={list.isFetching}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <Input aria-label={`搜索${name}`} placeholder="搜索名称" className="max-w-[280px]" value={q} onChange={(e) => setQ(e.target.value)} />
          {list.isFetching && <span className="text-[12.5px] text-ink-muted">加载中…</span>}
        </div>
        <div key={`${list.data?.page}-${list.pageSize}-${q}`} className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {!list.data ? <div className="p-4 text-ink-muted">{list.error ? '列表加载失败，请重试。' : '加载中…'}{list.error && <Button size="sm" onClick={() => void list.refetch()}>重试</Button>}</div> : !rows.length ? (
            <div className="p-4"><Empty title={q.trim() ? `没有名称包含「${q.trim()}」的${name}` : `还没有${name}`} description={!q.trim() && empty} action={!q.trim() && canCreate && createButton('sm', 'default')} /></div>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>{columns.map((c) => <th key={c.header} className={cx(th, 'px-3.5')}>{c.header}</th>)}{refreshable && <><th className={th}>状态</th><th className={th}>上次刷新时间</th></>}<th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <DocTableRow key={d.id} to={`/${kind}/${d.id}`}>
                    {columns.map((c, i) => (
                      <td key={c.header} className={cx(td, 'px-3.5 py-3 whitespace-nowrap', c.className)}>
                        {i === 0 ? <Link to={`/${kind}/${d.id}`} className={docNameLinkClass}>{c.cell(d)}</Link> : c.cell(d)}
                      </td>
                    ))}
                    {refreshable && <td className={td}><ResourceCacheStatus kind={kind} id={d.id}/></td>}
                    {refreshable && <td className={td}><ResourceLastRefreshTime kind={kind} id={d.id}/></td>}
                    <td className={cx(td, 'text-right whitespace-nowrap')}>
                      <div className="flex items-center justify-end gap-2">
                        {kind !== 'presets' && <ResourceLinkButton kind={kind} id={d.id} name={d.name} size="sm" />}
                        {refreshable&&canRefresh(d)&&<RefreshCacheButton kind={kind} id={d.id} name={d.name}/>}
                        {canWrite(d.id) && <Button size="sm" variant="danger" aria-label={`删除 ${d.name}`} onClick={() => { del.reset(); void Frame.modal.confirm({ title: `删除${name}「${d.name}」？`, description: deleteBody ?? '删除后无法恢复。', confirmLabel: '删除', danger: true }, { submit: async () => { await del.mutateAsync(d.id); } }); }}>删除</Button>}
                        <DocActionLink to={`/${kind}/${d.id}`} name={d.name} viewOnly={!canWrite(d.id)} />
                      </div>
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

    </>
  );
}
