import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog.tsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
  const qc=useQueryClient();const [open,setOpen]=useState(false);const [jobId,setJobId]=useState<string>();
  const refresh=useMutation({mutationFn:()=>api<{job:Job}>('POST',endpoint??`/${kind}/${id}/refresh-cache`,body??{}),onSuccess:r=>{qc.setQueryData(['refresh-job',r.job.id],r);setJobId(r.job.id);setOpen(true);},onError:()=>setOpen(true)});
  const job=useQuery({queryKey:['refresh-job',jobId],enabled:!!jobId,queryFn:()=>api<{job:Job}>('GET',`/refresh-jobs/${jobId}`),refetchInterval:q=>q.state.data?.job.state==='running'?500:false});
  const current=job.data?.job;
  useEffect(()=>{if(current && current.state!=='running')void qc.invalidateQueries();},[qc,jobId,current?.state]);
  const busy=refresh.isPending||current?.state==='running';
  return <span onClick={event=>event.stopPropagation()}>
    <Button size="sm" disabled={disabled||busy} aria-label={`${kind==='profiles'?'刷新全部资源':'刷新缓存'} ${name}`} onClick={()=>{setJobId(undefined);refresh.mutate();}}>{busy?'刷新中…':kind==='profiles'?'刷新全部资源':'刷新缓存'}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{`刷新缓存 · ${name}`}</DialogTitle></DialogHeader>
      <ErrorAlert error={refresh.error??job.error??current?.error} />
      {current && <div className="flex min-w-0 flex-col gap-3 whitespace-normal text-left">
        <p role="status" className="truncate" title={current.error??job.error?.message}>{job.error?'状态读取失败，正在重试…':current.state==='running'?`正在刷新：${current.completed} / ${current.total}`:current.state==='interrupted'?`刷新已中断${current.error?`：${current.error}`:''}`:`已完成：${current.results.filter(r=>r.ok===true).length} 项成功，${current.results.filter(r=>r.ok===false).length} 项失败`}</p>
        {!current.total && <p className="text-ink-muted">没有需要拉取的远程资源。</p>}
        {current.results.map((r,i)=><div key={i} className="min-w-0 rounded border border-line p-3 text-[13px]"><div className="break-words font-medium">{r.name}</div><div className={`truncate ${r.ok===false||r.state==='interrupted'?'text-red-600':'text-ink-muted'}`} title={refreshItemStatus(r)}>{refreshItemStatus(r)}</div></div>)}
        {kind==='profiles' && <p className={`truncate ${current.render?.ok===false?'text-red-600':'text-ink-muted'}`} title={current.render?.error}>{current.render?current.render.ok?'订阅配置已重新生成':`订阅生成失败：${current.render.error}`:current.state==='interrupted'?'订阅生成已中断':current.completed===current.total?'正在重新生成订阅配置…':'等待资源刷新后重新生成订阅配置'}</p>}
        <p className="text-[12px] text-ink-muted">客户端将在下一次更新时取得资源，也可以在客户端手动更新。</p>
      </div>}
    <DialogFooter><Button onClick={()=>{setOpen(false);void qc.invalidateQueries();}}>关闭</Button></DialogFooter></DialogContent></Dialog>
  </span>;
}
