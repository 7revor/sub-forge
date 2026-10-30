import { createModal, useModalPresentation, ModalContent, ModalHeader, ModalTitle } from '../modals/index.tsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api.ts';
import { Badge, Button, ErrorAlert, formatTime } from './ui.tsx';
export type ResourceState={name:string;lastSuccessAt?:number;lastAttemptAt?:number;nextFetchAt?:number;refreshing:boolean;error?:string;available:boolean};
type RefreshItem={name:string;state?:'pending'|'running'|'done'|'interrupted';ok?:boolean;available:boolean;error?:string};
type Job={id:string;state:'running'|'done'|'interrupted';total:number;completed:number;results:RefreshItem[];render?:{ok:boolean;error?:string};error?:string};
function refreshItemStatus(item:RefreshItem) {
  if(item.state==='pending')return '等待刷新';
  if(item.state==='running')return '刷新中…';
  if(item.state==='interrupted')return '刷新已中断';
  return item.ok?'拉取成功':`${item.error} · ${item.available?'继续使用上次成功内容':'没有可用缓存'}`;
}
function useResourceCacheState(kind:string,id:string) {
  return useQuery({queryKey:['resource-status',kind,id],queryFn:()=>api<{items:ResourceState[]}>('GET',`/${kind}/${id}/cache`)});
}
export function ResourceLastRefreshTime({kind,id}:{kind:string;id:string}) {
  const state=useResourceCacheState(kind,id);
  if(state.error)return <span className="text-[12px] text-red-600">状态读取失败</span>;
  if(!state.data)return <span className="text-ink-muted">读取中…</span>;
  const successful=state.data.items.filter((r):r is ResourceState & {lastSuccessAt:number}=>r.lastSuccessAt!==undefined);
  const lastSuccessAt=successful.length?Math.max(...successful.map(r=>r.lastSuccessAt)):undefined;
  return <span className="whitespace-nowrap text-ink-2" title={state.data.items.map(r=>`${r.name}：${r.lastSuccessAt!==undefined?formatTime(r.lastSuccessAt):'尚未刷新成功'}`).join('\n')}>
    {lastSuccessAt!==undefined?formatTime(lastSuccessAt):'—'}
  </span>;
}
export function ResourceCacheStatus({kind,id}:{kind:string;id:string}) {
  const state=useResourceCacheState(kind,id);
  if(state.error)return <span className="text-[12px] text-red-600">状态读取失败</span>;
  if(!state.data)return <span className="text-ink-muted">读取中…</span>;
  const items=state.data.items, failed=items.filter(r=>r.error), missing=items.filter(r=>!r.available), refreshing=items.some(r=>r.refreshing);
  return <span title={items.map(r=>`${r.name}：最后成功 ${r.lastSuccessAt?formatTime(r.lastSuccessAt):'无'}；下次拉取 ${r.nextFetchAt?formatTime(r.nextFetchAt):'待拉取'}${r.error?`；${r.error}`:''}`).join('\n')}>
    <Badge tone={refreshing?'neutral':failed.length||missing.length?'warn':items.length?'ok':'neutral'}>{!items.length?'本地资源':refreshing?'刷新中':failed.length?`${failed.length} 项失败${missing.length?' · 有资源不可用':' · 使用旧缓存'}`:missing.length?'待首次拉取':kind==='sources'?'正常':`${items.length} 项可用`}</Badge>
  </span>;
}
export function RefreshCacheButton({kind,id,name,endpoint,body,disabled=false}:{kind:string;id:string;name:string;endpoint?:string;body?:unknown;disabled?:boolean}) {
  const qc = useQueryClient();
  const refresh = useMutation({ mutationFn: () => api<{job:Job}>('POST', endpoint ?? `/${kind}/${id}/refresh-cache`, body ?? {}), onSuccess: async result => {
    qc.setQueryData(['refresh-job', result.job.id], result);
    await RefreshProgressModal.show({ name, kind, jobId: result.job.id });
    void qc.invalidateQueries();
  } });
  return <span onClick={event => event.stopPropagation()}><Button size="sm" disabled={disabled || refresh.isPending} aria-label={`${kind === 'profiles' ? '刷新全部资源' : '刷新缓存'} ${name}`} onClick={() => refresh.mutate()}>{refresh.isPending ? '刷新中…' : kind === 'profiles' ? '刷新全部资源' : '刷新缓存'}</Button></span>;
}
const RefreshProgressModal = createModal<{ name: string; kind: string; jobId: string }>(function RefreshProgress({ data: { name, kind, jobId }, modal }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['refresh-job', jobId], enabled: modal.active, queryFn: () => api<{job:Job}>('GET', `/refresh-jobs/${jobId}`), refetchInterval: q => q.state.data?.job.state === 'running' ? 500 : false });
  const job = useModalPresentation(query);
  const current = job.data?.job;
  useEffect(() => { if (current && current.state !== 'running') void qc.invalidateQueries(); }, [qc, current?.state]);
  return <ModalContent className="max-h-[85dvh] overflow-y-auto pb-12 sm:max-w-2xl" aria-describedby={undefined}><ModalHeader><ModalTitle>{`刷新缓存 · ${name}`}</ModalTitle></ModalHeader>
      <ErrorAlert error={job.error??current?.error} />
      {current && <div className="flex min-w-0 flex-col gap-3 whitespace-normal text-left">
        {!current.total && <p className="text-ink-muted">没有需要拉取的远程资源。</p>}
        {current.results.map((r,i)=><div key={i} className="min-w-0 rounded border border-line p-3 text-[13px]"><div className="break-words font-medium">{r.name}</div><div className={`truncate ${r.ok===false||r.state==='interrupted'?'text-red-600':'text-ink-muted'}`} title={refreshItemStatus(r)}>{refreshItemStatus(r)}</div></div>)}
        {kind==='profiles' && <p className={`truncate ${current.render?.ok===false?'text-red-600':'text-ink-muted'}`} title={current.render?.error}>{current.render?current.render.ok?'订阅配置已重新生成':`订阅生成失败：${current.render.error}`:current.state==='interrupted'?'订阅生成已中断':current.completed===current.total?'正在重新生成订阅配置…':'等待资源刷新后重新生成订阅配置'}</p>}
        <p role="status" className="truncate" title={current.error??job.error?.message}>{job.error?'状态读取失败，正在重试…':current.state==='running'?`正在刷新：${current.completed} / ${current.total}`:current.state==='interrupted'?`刷新已中断${current.error?`：${current.error}`:''}`:`已完成：${current.results.filter(r=>r.ok===true).length} 项成功，${current.results.filter(r=>r.ok===false).length} 项失败`}</p>
      </div>}
    </ModalContent>;
});
