import { ActionMenu } from './ActionMenu.tsx';
import { RepositoryModal } from './RepositoryModal.tsx';
import { Frame } from '../modals/Frame.tsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Plus } from 'lucide-react';
import { api, type RuleRepo } from '../api.ts';
import { Badge, Button, Empty, ErrorAlert, cx, formatTime } from './ui.tsx';

export function RepositoryManager({ repos, admin, loading = false, failed = false, onRetry }: { repos: RuleRepo[]; admin: boolean; loading?: boolean; failed?: boolean; onRetry?: () => void }) {
  const qc = useQueryClient();
  const edit = async (repo?: RuleRepo) => { const result = await RepositoryModal.show({ repo }); if (result.status === 'confirmed') void qc.invalidateQueries({ queryKey: ['rule-repos'] }); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ['rule-repos'] });
  const refresh = useMutation({ meta: { successMessage: '已提交索引更新，请查看仓库状态' }, mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: invalidate });
  const toggle = useMutation({ meta: { successMessage: '仓库状态已更新' }, mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: invalidate });
  const remove = useMutation({ meta: { successMessage: '仓库已删除', modalErrors: true }, mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: invalidate });
  return <section aria-label="仓库" className="flex shrink-0 flex-col gap-3">
    <div className="list-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="m-0 text-base font-semibold">仓库</h2>
        {admin && <Button onClick={() => void edit()}><Plus size={16} />添加仓库</Button>}
      </div>
      <div className="flex max-h-[min(30vh,240px)] min-h-0 flex-col gap-2 overflow-auto px-5 pb-5" aria-busy={loading}>
        {loading ? <div role="status" className="py-4 text-ink-muted">正在加载仓库…</div> : repos.map(r => <div key={r.id} className="grid min-h-[52px] grid-cols-[32px_minmax(0,1fr)_96px] items-center gap-3 rounded-[10px] border border-line bg-panel px-4 py-2 text-[length:var(--text-control)] md:grid-cols-[32px_minmax(0,1fr)_96px_112px_36px]">
          <span className={cx('grid size-8 place-items-center rounded-lg', r.enabled ? 'bg-accent-soft text-accent-ink' : 'bg-neutral-soft text-ink-muted')}><GitBranch size={16} /></span>
          <div className="min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:text-brand" title={r.name}>{r.name}</a>
            <div className="mt-0.5 truncate text-[length:var(--text-caption)] text-ink-muted">{r.refs.join('、')} · {r.entries} 个文件 · {r.builtAt ? `${formatTime(r.builtAt).slice(5)} 更新` : '等待建立索引'}</div>
            {r.pending && r.builtAt && <div className="mt-1 text-[length:var(--text-caption)] text-ink-muted">新配置待同步，搜索仍使用上次成功索引。</div>}
            {r.error && <div className="mt-1 break-words text-[length:var(--text-caption)] text-err">{r.error}{r.builtAt ? '（保留上次索引）' : ''}</div>}
          </div>
          <span><Badge tone={!r.enabled ? 'neutral' : r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? '更新失败' : r.builtAt ? '已索引' : '待索引'}</Badge></span>
          {admin ? <><Button size="sm" disabled={!r.enabled || r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button><ActionMenu label={`${r.name}更多操作`}><Button size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button><Button size="sm" onClick={() => void edit(r)}>编辑</Button><Button size="sm" variant="danger" aria-label={`删除 ${r.name}`} disabled={r.indexing || remove.isPending} onClick={() => { remove.reset(); void Frame.modal.confirm({ title: `删除仓库「${r.name}」？`, description: '仓库及其索引会被删除，无法恢复。已创建的增强集合会保留；仍被模板或配置订阅直接引用时不能删除。', confirmLabel: '删除', danger: true }, { submit: async () => { await remove.mutateAsync(r.id); } }); }}>删除</Button></ActionMenu></> : <><span /><span /></>}
        </div>)}
        {failed && <div className="p-4 text-ink-muted">仓库加载失败。<Button size="sm" onClick={onRetry}>重试</Button></div>}
        {!loading && !failed && !repos.length && <div className="p-4"><Empty title="还没有仓库" /></div>}
      </div>
    </div>
    <ErrorAlert error={refresh.error ?? toggle.error} />
  </section>;
}
