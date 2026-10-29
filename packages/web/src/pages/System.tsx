// 系统（设计稿「管理员 · 系统」）：SSRF 白名单、mihomo 配置校验、规则仓库、备份与恢复。
// 服务端尚未实现：读接口返回空数据并带 pending，保存、导出、恢复返回 501。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CustomRepoDialog } from '../components/CustomRepoDialog.tsx';
import { api, type RuleRepo, type SystemInfo } from '../api.ts';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, PageScroll, PendingNotice, Switch, formatBytes, formatTime } from '../components/ui.tsx';

export function System() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('GET', '/system') });
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ pending?: boolean; repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const [draft, setDraft] = useState<SystemInfo>();
  const [allow, setAllow] = useState('');
  const [addingRepo, setAddingRepo] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState<RuleRepo>();
  useEffect(() => { if (info.data) setDraft(info.data); }, [info.data]);
  const save = useMutation({ mutationFn: (body: SystemInfo) => api('PUT', '/system', body), onSuccess: () => qc.invalidateQueries({ queryKey: ['system'] }) });
  const backup = useMutation({ mutationFn: () => api('POST', '/system/backup') });
  const restore = useMutation({ mutationFn: (file: File) => file.text().then((text) => api('POST', '/system/restore', JSON.parse(text) as unknown)) });
  const refreshRepo = useMutation({ mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-repos'] }) });
  const toggleRepo = useMutation({ mutationFn: (r: RuleRepo) => api('PATCH', `/rule-repos/${r.id}`, { enabled: !r.enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-repos'] }) });
  const removeRepo = useMutation({ mutationFn: (id: string) => api('DELETE', `/rule-repos/${id}`), onSuccess: () => { setDeletingRepo(undefined); return qc.invalidateQueries({ queryKey: ['rule-repos'] }); } });

  if (!draft) return info.error ? <ErrorBox error={info.error} /> : <div className="text-muted">加载中…</div>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(info.data);
  const verify = draft.verify ?? { enabled: false };

  return (
    <>
      <PageHeader title="系统" actions={<Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>} />
      {info.data?.pending && <PendingNotice>除规则仓库管理外，其余系统设置暂不可用。</PendingNotice>}
      <ErrorBox error={save.error} />

      <PageScroll>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-5">
            <Card title={`远程拉取 · SSRF 防护`} subtitle={`默认禁止拉取内网与保留地址。以下地址例外放行。`}>
              <div className="flex flex-col">
                {draft.ssrfAllow.map((a, i) => (
                  <div key={a.value} className="flex items-center gap-3 border-t border-line-2 py-2.5 first:border-0">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="font-mono text-[13px]">{a.value}</span>{a.note && <span className="text-[12px] text-muted">{a.note}</span>}</span>
                    <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${a.value}`} onClick={() => setDraft({ ...draft, ssrfAllow: draft.ssrfAllow.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                ))}
                {!draft.ssrfAllow.length && <Empty title="没有白名单例外" />}
              </div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (allow.trim()) { setDraft({ ...draft, ssrfAllow: [...draft.ssrfAllow, { value: allow.trim() }] }); setAllow(''); } }}>
                <Input aria-label="新增白名单" placeholder="主机名或 CIDR" className="font-mono" value={allow} onChange={(e) => setAllow(e.target.value)} />
                <Button type="submit" disabled={!allow.trim()}>添加</Button>
              </form>
            </Card>

            <Card title="配置校验">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex flex-col gap-0.5"><span className="text-[13.5px] font-medium">渲染后用内置 mihomo 执行 -t</span><span className="text-[12.5px] text-muted">失败时返回上一份成功版本并告警</span></span>
                  <Switch label="mihomo 校验" checked={verify.enabled} onChange={(enabled) => setDraft({ ...draft, verify: { ...verify, enabled } })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{verify.version ? `内置 mihomo ${verify.version}` : '未检测到 mihomo'}</Badge>
                  {verify.checks24h !== undefined && <Badge tone={verify.fails24h ? 'warn' : 'neutral'}>近 24 小时校验 {verify.checks24h} 次 · 失败 {verify.fails24h ?? 0} 次</Badge>}
                </div>
                <span className="text-[12px] leading-relaxed text-muted">引用校验始终开启。</span>
              </div>
            </Card>
          </div>

          <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-5">
            <Card title="规则仓库" actions={<Button onClick={() => setAddingRepo(true)}><Plus size={15} />添加自定义仓库</Button>}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col">
                  {(repos.data?.repos ?? []).map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-line-2 py-2.5 first:border-0">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{r.name}</span><span className="truncate text-[12px] text-muted">{r.builtIn ? '内置' : `${r.url} · ${r.ref ?? ''} · ${r.directory || '根目录'}`}{r.entries !== undefined ? ` · ${r.entries} 个规则` : ''}{r.builtAt ? ` · ${formatTime(r.builtAt).slice(5)} 建索引` : ''}</span></span>
                      <Badge tone={r.error ? 'err' : r.builtAt ? 'ok' : 'neutral'}>{!r.enabled ? '已停用' : r.indexing ? '更新中…' : r.error ? r.error : r.builtAt ? '已索引' : '等待首次索引'}</Badge>
                      <Button size="sm" disabled={!r.enabled || r.indexing || refreshRepo.isPending} onClick={() => refreshRepo.mutate(r.id)}>更新索引</Button>
                      <Button size="sm" disabled={toggleRepo.isPending} onClick={() => toggleRepo.mutate(r)}>{r.enabled ? '停用' : '启用'}</Button>
                      {!r.builtIn && <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`删除 ${r.name}`} disabled={r.indexing || removeRepo.isPending} onClick={() => { removeRepo.reset(); setDeletingRepo(r); }}><Trash2 size={14} /></Button>}
                    </div>
                  ))}
                  {!repos.data?.repos.length && <Empty title="还没有仓库索引" />}
                </div>
                <ErrorBox error={repos.error ?? removeRepo.error ?? refreshRepo.error ?? toggleRepo.error} />
                <Field label="GitHub 镜像地址" hint="镜像设置暂不生效">{(id) => <Input id={id} className="font-mono" placeholder="https://[MIRROR]/" value={draft.mirror} onChange={(e) => setDraft({ ...draft, mirror: e.target.value })} />}</Field>
              </div>
            </Card>

            <Card title="备份与恢复">
              <div className="flex flex-col gap-3">
                <span className="text-[12.5px] leading-relaxed text-ink-2">导出 JSON 配置，不含快照和缓存；敏感字段保持加密。</span>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => backup.mutate()} disabled={backup.isPending}>{backup.isPending ? '导出中…' : '导出备份'}</Button>
                  <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#d5d9e0] bg-panel px-3.5 text-[13.5px] font-medium hover:bg-ground">
                    从文件恢复…<input type="file" accept="application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm('恢复会覆盖当前全部配置，确定？')) restore.mutate(f); e.target.value = ''; }} />
                  </label>
                </div>
                <span className="text-[12.5px] text-muted">{draft.lastBackup ? `上次导出：${formatTime(draft.lastBackup.at).slice(5)} · ${formatBytes(draft.lastBackup.size)}` : '还没有导出过'}</span>
                <ErrorBox error={backup.error ?? restore.error} />
              </div>
            </Card>
          </div>
        </div>

      </PageScroll>
      <CustomRepoDialog open={addingRepo} onClose={() => setAddingRepo(false)} />
      <Modal title="删除自定义仓库" open={!!deletingRepo} onClose={() => { if (!removeRepo.isPending) setDeletingRepo(undefined); }}
        footer={<><Button disabled={removeRepo.isPending} onClick={() => setDeletingRepo(undefined)}>取消</Button><Button variant="danger" disabled={removeRepo.isPending} onClick={() => deletingRepo && removeRepo.mutate(deletingRepo.id)}>{removeRepo.isPending ? '删除中…' : '删除'}</Button></>}>
        <p className="m-0 text-[13px]">删除「{deletingRepo?.name}」及其索引？已导入的规则集会保留。</p>
        <ErrorBox error={removeRepo.error} />
      </Modal>
    </>
  );
}
