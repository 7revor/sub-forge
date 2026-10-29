import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, type RuleRepo } from '../api.ts';
import { Badge, Button, Card, Empty, ErrorBox, buttonClass, formatTime } from './ui.tsx';

export function RepositoryManager({ repos, admin }: { repos: RuleRepo[]; admin: boolean }) {
  const qc = useQueryClient();
  const { search } = useLocation();
  const [deleting, setDeleting] = useState<RuleRepo>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['rule-repos'] });
  const refresh = useMutation({ mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: invalidate });
  const toggle = useMutation({ mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: () => { setDeleting(undefined); return invalidate(); } });
  return <>
    <Card title="仓库" subtitle="仅扫描 .list 和 .txt 文件" className="shrink-0" bodyClass="px-4 pb-4" actions={admin && <><Link to={`/rule-repo/settings${search}`} className={buttonClass('default', 'sm')}>GitHub Token</Link><Link to={`/rule-repo/new${search}`} className={buttonClass('default', 'sm')}><Plus size={14} />添加仓库</Link></>}>
      <div aria-label="仓库管理" className="grid max-h-[26vh] min-h-0 grid-cols-1 gap-2 overflow-y-auto overscroll-contain xl:grid-cols-2">
        {repos.map(r => <div key={r.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-2 px-3 py-2.5">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="break-all text-[13px] font-medium text-ink">{r.name}</a><div className="text-[11.5px] text-muted">{r.refs.join('、')} · {r.entries} 个规则{r.builtAt ? ` · ${formatTime(r.builtAt).slice(5)} 更新` : ''}</div></div>
            <Badge tone={r.enabled && r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? '更新失败' : r.builtAt ? '已索引' : '待索引'}</Badge>
          </div>
          {r.pending && r.builtAt && <span className="text-[12px] text-muted">新配置待同步，搜索仍使用上次成功索引。</span>}
          {r.error && <span className="break-words text-[12px] text-err">{r.error}{r.builtAt ? '（保留上次索引）' : ''}</span>}
          {admin && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!r.enabled || r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button><Button size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button><Link to={`/rule-repo/${encodeURIComponent(r.id)}/edit${search}`} className={buttonClass('default', 'sm')}>编辑</Link><Button size="sm" variant="ghost" aria-label={`删除 ${r.name}`} disabled={r.indexing || remove.isPending} onClick={() => { remove.reset(); setDeleting(r); }}><Trash2 size={14} />删除</Button></div>}
          {admin && deleting?.id === r.id && <div role="alert" aria-label="删除仓库确认" className="flex flex-col gap-2 border-t border-line-2 pt-2 text-[13px]">
            <span>删除「{r.name}」及其索引？已创建的规则集会保留。</span>
            <div className="flex gap-2"><Button size="sm" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>取消</Button><Button size="sm" variant="danger" disabled={remove.isPending || r.indexing} onClick={() => remove.mutate(r.id)}>{remove.isPending ? '删除中…' : '确认删除'}</Button></div>
            <ErrorBox error={remove.error} />
          </div>}
        </div>)}
        {!repos.length && <Empty title="还没有仓库" />}
      </div>
      <ErrorBox error={refresh.error ?? toggle.error} />
    </Card>
  </>;
}
