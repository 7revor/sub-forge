import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api, type RuleRepo } from '../api.ts';
import { Badge, Button, Card, Empty, ErrorAlert, buttonClass, formatTime, th, td } from './ui.tsx';

export function RepositoryManager({ repos, admin }: { repos: RuleRepo[]; admin: boolean }) {
  const qc = useQueryClient();
  const { search } = useLocation();
  const [deleting, setDeleting] = useState<RuleRepo>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['rule-repos'] });
  const refresh = useMutation({ meta: { successMessage: '已提交索引更新，请查看仓库状态' }, mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: invalidate });
  const toggle = useMutation({ meta: { successMessage: '仓库状态已更新' }, mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: invalidate });
  const remove = useMutation({ meta: { successMessage: '仓库已删除' }, mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: () => { setDeleting(undefined); return invalidate(); } });
  return <>
    <Card title="仓库" subtitle="仅索引目录、.list 和 .txt 文件" className="shrink-0" bodyClass="px-4 pb-4" actions={admin && <><Link to={`/rule-repo/new${search}`} className={buttonClass('default', 'sm')}><Plus size={14} />添加仓库</Link></>}>
      <div className="max-h-[30vh] min-h-0 overflow-auto overscroll-contain rounded-lg border border-line-2">
        <table aria-label="仓库管理" className="w-full min-w-[760px] border-collapse">
          <thead className="sticky top-0 z-10 bg-panel"><tr>{['仓库名称', '分支', '规则数', '更新时间', '状态', ...(admin ? ['操作'] : [])].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
          <tbody>{repos.map(r => <Fragment key={r.id}>
            <tr>
              <td className={td}><a href={r.url} target="_blank" rel="noreferrer" className="break-all font-medium text-ink hover:text-accent">{r.name}</a>
                {r.pending && r.builtAt && <div className="mt-1 text-[12px] text-muted">新配置待同步，搜索仍使用上次成功索引。</div>}
                {r.error && <div className="mt-1 max-w-sm break-words text-[12px] text-err">{r.error}{r.builtAt ? '（保留上次索引）' : ''}</div>}
              </td>
              <td className={td}><span className="break-all">{r.refs.join('、')}</span></td>
              <td className={`${td} tabular-nums`}>{r.entries}</td>
              <td className={`${td} whitespace-nowrap text-muted`}>{r.builtAt ? formatTime(r.builtAt).slice(5) : '—'}</td>
              <td className={td}><Badge tone={!r.enabled ? 'neutral' : r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? '更新失败' : r.builtAt ? '已索引' : '待索引'}</Badge></td>
              {admin && <td className={`${td} w-px`}><div className="flex gap-2"><Button size="sm" disabled={!r.enabled || r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button><Button size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button><Link to={`/rule-repo/${encodeURIComponent(r.id)}/edit${search}`} className={buttonClass('default', 'sm')}>编辑</Link><Button size="sm" variant="ghost" aria-label={`删除 ${r.name}`} disabled={r.indexing || remove.isPending} onClick={() => { remove.reset(); setDeleting(r); }}><Trash2 size={14} />删除</Button></div></td>}
            </tr>
          {admin && deleting?.id === r.id && <tr><td colSpan={6} className={td}><div role="alert" aria-label="删除仓库确认" className="flex flex-col gap-2 text-[13px]">
            <span>删除「{r.name}」及其索引？已创建的增强集合会保留；仍被模板或配置订阅直接引用时不能删除。</span>
            <div className="flex gap-2"><Button size="sm" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>取消</Button><Button size="sm" variant="danger" disabled={remove.isPending || r.indexing} onClick={() => remove.mutate(r.id)}>{remove.isPending ? '删除中…' : '确认删除'}</Button></div>
            <ErrorAlert error={remove.error} />
          </div></td></tr>}
          </Fragment>)}
          {!repos.length && <tr><td colSpan={admin ? 6 : 5} className={td}><Empty title="还没有仓库" /></td></tr>}
          </tbody>
        </table>
      </div>
      <ErrorAlert error={refresh.error ?? toggle.error} />
    </Card>
  </>;
}
