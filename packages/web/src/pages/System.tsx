import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { BackupSettings } from '../components/BackupSettings.tsx';
import { RefreshCacheButton, type ResourceState } from '../components/ResourceCache.tsx';
import { Badge,Button,Card,ErrorAlert,Field,Input,PageHeader,PageScroll,formatTime } from '../components/ui.tsx';
function RetryResource({resource:r}:{resource:ResourceState}) {
  const qc=useQueryClient();
  const retry=useMutation({mutationFn:()=>api('POST',`/rule-repos/${r.repositoryId}/refresh`,{}),onSuccess:()=>qc.invalidateQueries({queryKey:['system-resources']})});
  return r.resource ? <RefreshCacheButton kind="system-resource" id={r.resource} name={r.name} label="立即重试" endpoint={`/system/resources/${encodeURIComponent(r.resource)}/refresh`} disabled={r.refreshing}/> : r.repositoryId ? <Button size="sm" disabled={retry.isPending||r.refreshing} onClick={()=>retry.mutate()}>{retry.isPending||r.refreshing?'重试中…':'立即重试'}</Button> : null;
}
export function System(){
  const qc=useQueryClient();const [hours,setHours]=useState<string>();
  const info=useQuery({queryKey:['system'],queryFn:()=>api<{resourceCacheTtlSec:number;nextCacheExpiryAt:number}>('GET','/system')});
  const resources=useQuery({queryKey:['system-resources'],queryFn:()=>api<{items:ResourceState[]}>('GET','/system/resources')});
  const save=useMutation({meta:{successMessage:'资源缓存设置已保存'},mutationFn:()=>api('PUT','/system',{resourceCacheTtlSec:Number(hours)*3600}),onSuccess:()=>{setHours(undefined);void qc.invalidateQueries();}});
  const value=hours??String((info.data?.resourceCacheTtlSec??86400)/3600);const valid=Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=8760;
  const failures=resources.data?.items.filter(r=>r.error)??[];
  return <><PageHeader title="系统" actions={<Button variant="primary" disabled={hours===undefined||!valid||save.isPending||!info.data} onClick={()=>save.mutate()}>{save.isPending?'保存中…':hours===undefined?'已保存':'保存'}</Button>}/>
    <ErrorAlert error={info.error??save.error??resources.error}/><PageScroll>
      <section className="settings-panel"><div className="settings-row"><div><h2>资源缓存</h2><p>节点、规则、仓库索引与客户端更新间隔共用一个周期，按服务器本地时间 0 点对齐</p></div><div className="flex max-w-lg flex-col gap-2">
        <div className="flex max-w-[360px] items-center"><Input className="rounded-r-none" aria-label="资源缓存时间（小时）" placeholder="填写缓存小时数，1 至 8760" type="number" min={1} max={8760} step={1} value={value} onChange={event=>setHours(event.target.value)} /><span className="flex h-9 shrink-0 items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">小时</span></div>
        {!valid && <span className="text-sm text-destructive">请输入 1 至 8760 的整数小时。</span>}<p>下次缓存失效时间：{info.data?formatTime(info.data.nextCacheExpiryAt):'读取中…'}</p>
        <p>规则快照到期立刻失效，下次请求时读源，失败不用旧内容。节点在新周期下次使用时重新拉取，失败时继续使用旧内容，下个周期再试。仓库索引按周期自动同步。</p>
      </div></div>
      <div className="settings-row"><div><h2 className="flex items-center gap-1.5">资源异常 <Badge tone="err" className="h-5">{failures.length}</Badge></h2><p>节点订阅和仓库索引最近的失败，下个周期自动重试</p></div><div>
        {!resources.data?<p className="text-muted-foreground">正在读取状态…</p>:!failures.length?<p className="text-muted-foreground">当前没有资源拉取异常。</p>:<div className="flex flex-col gap-3">{failures.map((r,i)=><div key={i} className="rounded-lg border border-border px-3 py-2.5 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium">{r.name}</span><RetryResource resource={r}/></div><p className="text-red-600">{r.error} · {r.available?'正在使用旧内容':'没有可用内容'}</p><p className="text-muted-foreground">最后成功：{r.lastSuccessAt?formatTime(r.lastSuccessAt):'从未成功'}</p></div>)}</div>}
      </div></div>
      <BackupSettings />
    </section></PageScroll></>;
}
