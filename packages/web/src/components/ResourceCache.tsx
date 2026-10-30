import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api.ts';
import { Badge, Button, ErrorAlert, formatTime } from './ui.tsx';
export type ResourceState={name:string;lastSuccessAt?:number;lastAttemptAt?:number;nextFetchAt?:number;refreshing:boolean;error?:string;available:boolean};
type Job={id:string;state:'running'|'done'|'interrupted';total:number;completed:number;results:{name:string;ok:boolean;available:boolean;error?:string}[];render?:{ok:boolean;error?:string};error?:string};
export function ResourceCacheStatus({kind,id}:{kind:string;id:string}) {
  const state=useQuery({queryKey:['resource-status',kind,id],queryFn:()=>api<{items:ResourceState[]}>('GET',`/${kind}/${id}/cache`)});
  if(state.error)return <span className="text-[12px] text-red-600">状态读取失败</span>;
  if(!state.data)return <span className="text-ink-muted">读取中…</span>;
  const items=state.data.items, failed=items.filter(r=>r.error), missing=items.filter(r=>!r.available);
  return <span title={items.map(r=>`${r.name}：最后成功 ${r.lastSuccessAt?formatTime(r.lastSuccessAt):'无'}；下次拉取 ${r.nextFetchAt?formatTime(r.nextFetchAt):'待拉取'}${r.error?`；${r.error}`:''}`).join('\n')}>
    <Badge tone={failed.length||missing.length?'warn':'neutral'}>{!items.length?'本地资源':items.some(r=>r.refreshing)?'刷新中':failed.length?`${failed.length} 项失败${missing.length?' · 有资源不可用':' · 使用旧缓存'}`:missing.length?'待首次拉取':`${items.length} 项可用`}</Badge>
  </span>;
}
export function RefreshCacheButton({kind,id,name,endpoint,body,disabled=false}:{kind:string;id:string;name:string;endpoint?:string;body?:unknown;disabled?:boolean}) {
  const qc = useQueryClient();
  const refresh = useMutation({ mutationFn: () => api<{job:Job}>('POST', endpoint ?? `/${kind}/${id}/refresh-cache`, body ?? {}), onSuccess: async result => {
    qc.setQueryData(['refresh-job', result.job.id], result);
    await RefreshProgressModal.show({ name, jobId: result.job.id });
    void qc.invalidateQueries();
  } });
  return <span onClick={event => event.stopPropagation()}><Button size="sm" disabled={disabled || refresh.isPending} aria-label={`${kind === 'profiles' ? '刷新全部资源' : '刷新缓存'} ${name}`} onClick={() => refresh.mutate()}>{refresh.isPending ? '刷新中…' : kind === 'profiles' ? '刷新全部资源' : '刷新缓存'}</Button></span>;
}
const RefreshProgressModal = createModal<{ name: string; jobId: string }>(function RefreshProgress({ data: { name, jobId }, modal }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['refresh-job', jobId], enabled: modal.active, queryFn: () => api<{job:Job}>('GET', `/refresh-jobs/${jobId}`), refetchInterval: q => q.state.data?.job.state === 'running' ? 500 : false });
  const job = useModalPresentation(query);
  const current = job.data?.job;
  useEffect(() => { if (current && current.state !== 'running') void qc.invalidateQueries(); }, [qc, current?.state]);
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><ModalHeader><ModalTitle>{`刷新缓存 · ${name}`}</ModalTitle></ModalHeader>
      <ErrorAlert error={job.error??current?.error} />
      {current && <div className="flex flex-col gap-3 whitespace-normal text-left">
        <p role="status">{current.state==='running'?`正在刷新：${current.completed} / ${current.total}`:current.state==='interrupted'?'刷新已中断':`已完成：${current.results.filter(r=>r.ok).length} 项成功，${current.results.filter(r=>!r.ok).length} 项失败`}</p>
        {!current.total && <p className="text-ink-muted">没有需要拉取的远程资源。</p>}
        {current.results.map((r,i)=><div key={i} className="rounded border border-line p-3 text-[13px]"><div className="font-medium">{r.name}</div><div className={r.ok?'text-ink-muted':'text-red-600'}>{r.ok?'拉取成功':`${r.error} · ${r.available?'继续使用上次成功内容':'没有可用缓存'}`}</div></div>)}
        {current.render && <p className={current.render.ok?'text-ink-muted':'text-red-600'}>{current.render.ok?'订阅配置已重新生成':`订阅生成失败：${current.render.error}`}</p>}
        {current.state==='done' && <p className="text-[12px] text-ink-muted">客户端将在下一次更新时取得资源，也可以在客户端手动更新。</p>}
      </div>}
    <ModalFooter><Button onClick={modal.cancel}>关闭</Button></ModalFooter></ModalContent>;
});
