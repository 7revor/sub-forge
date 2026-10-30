import { ListTable, ListTableLoading } from './ListTable.tsx';
import { ListActions } from './ListActions.tsx';
import { actionHeader } from './DocTableRow.tsx';
import { Frame } from '../modals/Frame.tsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { api, type RuleRepo } from '../api.ts';
import { Badge, Button, Empty, ErrorAlert, buttonClass, cx, formatTime, listMono, listTd } from './ui.tsx';

export function RepositoryManager({ repos, admin, loading = false, failed = false, onRetry }: { repos: RuleRepo[]; admin: boolean; loading?: boolean; failed?: boolean; onRetry?: () => void }) {
  const qc = useQueryClient();
  const { search } = useLocation();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['rule-repos'] });
  const refresh = useMutation({ meta: { successMessage: '已提交索引更新，请查看仓库状态' }, mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: invalidate });
  const toggle = useMutation({ meta: { successMessage: '仓库状态已更新' }, mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: invalidate });
  const remove = useMutation({ meta: { successMessage: '仓库已删除', modalErrors: true }, mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: invalidate });
  return <section aria-label="仓库" className="flex shrink-0 flex-col gap-3">
    <div className="list-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 table-panel-divider-bottom px-6 py-4">
        <h2 className="m-0 text-base font-semibold">仓库</h2>
        {admin && <Link to={`/rule-repo/new${search}`} className={buttonClass('default')}><Plus size={16} />添加仓库</Link>}
      </div>
      <div className="list-table-scroll max-h-[min(30vh,240px)] min-h-0 overflow-auto overscroll-contain" aria-busy={loading}>
        <ListTable label="仓库管理" columns={[
          { header: '仓库名称', width: 180 }, { header: '分支', width: 136 }, { header: '规则数', width: 72 },
          { header: '更新时间', width: 136 }, { header: '状态', width: 96 }, ...(admin ? [{ header: actionHeader, width: 288 }] : []),
        ]}>
          {loading ? <ListTableLoading columns={admin ? 6 : 5} rows={3} /> : repos.map(r => <tr key={r.id} className="hover:bg-ground focus-within:bg-ground">
              <td className={listTd}><a href={r.url} target="_blank" rel="noreferrer" className="break-all font-medium text-ink hover:text-brand">{r.name}</a>
                {r.pending && r.builtAt && <div className="mt-1 text-[12px] text-ink-muted">新配置待同步，搜索仍使用上次成功索引。</div>}
                {r.error && <div className="mt-1 max-w-sm break-words text-[12px] text-err">{r.error}{r.builtAt ? '（保留上次索引）' : ''}</div>}
              </td>
              <td className={listTd}><span className="break-all font-mono text-[13px]">{r.refs.join('、')}</span></td>
              <td className={cx(listTd, listMono)}>{r.entries}</td>
              <td className={cx(listTd, listMono, 'whitespace-nowrap text-ink-2')}>{r.builtAt ? formatTime(r.builtAt).slice(5) : '—'}</td>
              <td className={listTd}><Badge tone={!r.enabled ? 'neutral' : r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? '更新失败' : r.builtAt ? '已索引' : '待索引'}</Badge></td>
              {admin && <td className={listTd}><ListActions><Button size="sm" disabled={!r.enabled || r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button><Button size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button><Link to={`/rule-repo/${encodeURIComponent(r.id)}/edit${search}`} aria-label={`编辑 ${r.name}`} className={buttonClass('default', 'sm')}>编辑</Link><Button size="sm" variant="danger" aria-label={`删除 ${r.name}`} disabled={r.indexing || remove.isPending} onClick={() => { remove.reset(); void Frame.modal.confirm({ title: `删除仓库「${r.name}」？`, description: '仓库及其索引会被删除，无法恢复。已创建的增强集合会保留；仍被模板或配置订阅直接引用时不能删除。', confirmLabel: '删除', danger: true }, { submit: async () => { await remove.mutateAsync(r.id); } }); }}>删除</Button></ListActions></td>}
            </tr>)}
        </ListTable>
        {failed && <div className="p-4 text-ink-muted">仓库加载失败。<Button size="sm" onClick={onRetry}>重试</Button></div>}
        {!loading && !failed && !repos.length && <div className="p-4"><Empty title="还没有仓库" /></div>}
      </div>
    </div>
    <ErrorAlert error={refresh.error ?? toggle.error} />
  </section>;
}
