import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type RuleRepo } from '../api.ts';
import { CustomRepoDialog } from './CustomRepoDialog.tsx';
import { GithubTokenSettings } from './GithubTokenSettings.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Modal, formatTime } from './ui.tsx';

export function RepositoryManager({ repos, admin }: { repos: RuleRepo[]; admin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RuleRepo>();
  const [adding, setAdding] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [deleting, setDeleting] = useState<RuleRepo>();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['rule-repos'] });
  const refresh = useMutation({ mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: invalidate });
  const toggle = useMutation({ mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: () => { setDeleting(undefined); return invalidate(); } });
  return <>
    <Card title="仓库" subtitle="仅扫描 .list 和 .txt 文件" className="shrink-0" bodyClass="px-4 pb-4" actions={admin && <><Button size="sm" onClick={() => setTokenOpen(true)}>GitHub Token</Button><Button size="sm" onClick={() => setAdding(true)}><Plus size={14} />添加仓库</Button></>}>
      <div aria-label="仓库管理" className="grid max-h-[26vh] min-h-0 grid-cols-1 gap-2 overflow-y-auto overscroll-contain xl:grid-cols-2">
        {repos.map(r => <div key={r.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-2 px-3 py-2.5">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="break-all text-[13px] font-medium text-ink">{r.name}</a><div className="text-[11.5px] text-muted">{r.refs.join('、')} · {r.entries} 个规则{r.builtAt ? ` · ${formatTime(r.builtAt).slice(5)} 更新` : ''}</div></div>
            <Badge tone={r.enabled && r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? '更新失败' : r.builtAt ? '已索引' : '待索引'}</Badge>
          </div>
          {r.pending && r.builtAt && <span className="text-[12px] text-muted">新配置待同步，搜索仍使用上次成功索引。</span>}
          {r.error && <span className="break-words text-[12px] text-err">{r.error}{r.builtAt ? '（保留上次索引）' : ''}</span>}
          {admin && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!r.enabled || r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button><Button size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button><Button size="sm" disabled={r.indexing} onClick={() => setEditing(r)}>编辑</Button><Button size="sm" variant="ghost" aria-label={`删除 ${r.name}`} disabled={r.indexing || remove.isPending} onClick={() => { remove.reset(); setDeleting(r); }}><Trash2 size={14} />删除</Button></div>}
        </div>)}
        {!repos.length && <Empty title="还没有仓库" />}
      </div>
      <ErrorBox error={refresh.error ?? toggle.error} />
    </Card>
    <CustomRepoDialog open={adding || !!editing} repo={editing} onClose={() => { setAdding(false); setEditing(undefined); }} />
    <Modal title="GitHub API 认证" open={tokenOpen} onClose={() => setTokenOpen(false)}><GithubTokenSettings /></Modal>
    <Modal title="删除仓库" open={!!deleting} onClose={() => { if (!remove.isPending) setDeleting(undefined); }}
      footer={<><Button disabled={remove.isPending} onClick={() => setDeleting(undefined)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>{remove.isPending ? '删除中…' : '删除'}</Button></>}>
      <p className="m-0 text-[13px]">删除「{deleting?.name}」及其索引？已创建的规则集会保留。</p><ErrorBox error={remove.error} />
    </Modal>
  </>;
}
