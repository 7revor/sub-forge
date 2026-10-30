import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import type { ResourceState } from '../components/ResourceCache.tsx';
import { Button,Card,ErrorAlert,Field,Input,PageHeader,PageScroll,formatTime } from '../components/ui.tsx';
export function System(){
  const qc=useQueryClient();const [hours,setHours]=useState<string>();
  const info=useQuery({queryKey:['system'],queryFn:()=>api<{resourceCacheTtlSec:number}>('GET','/system')});
  const resources=useQuery({queryKey:['system-resources'],queryFn:()=>api<{items:ResourceState[]}>('GET','/system/resources')});
  const save=useMutation({meta:{successMessage:'资源缓存设置已保存'},mutationFn:()=>api('PUT','/system',{resourceCacheTtlSec:Number(hours)*3600}),onSuccess:()=>{setHours(undefined);void qc.invalidateQueries();}});
  const value=hours??String((info.data?.resourceCacheTtlSec??86400)/3600);const valid=Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=8760;
  const failures=resources.data?.items.filter(r=>r.error)??[];
  return <><PageHeader title="系统" actions={<Button variant="primary" disabled={hours===undefined||!valid||save.isPending||!info.data} onClick={()=>save.mutate()}>{save.isPending?'保存中…':'保存'}</Button>}/>
    <ErrorAlert error={info.error??save.error??resources.error}/><PageScroll>
      <Card title="资源缓存" subtitle="节点、规则、仓库索引及客户端更新间隔统一使用此设置。">
        <div className="flex max-w-[620px] flex-col gap-4">
          <Field label="资源缓存时间（小时）">{id=><Input id={id} type="number" min={1} max={8760} step={1} value={value} onChange={e=>setHours(e.target.value)} />}</Field>
          {!valid&&<p className="text-[13px] text-red-600">请输入 1 至 8760 的整数小时。</p>}
          <p className="text-[13px] leading-relaxed text-muted">每个资源只保留最后一次成功内容。到期自动拉取，失败时保留旧内容并延后一个周期再次尝试；列表中的“刷新缓存”可立即重新拉取。</p>
          <p className="text-[13px] text-muted">设置保存后立即应用于服务端。客户端更新间隔在其下次下载配置后生效。</p>
        </div>
      </Card>
      <Card title={`资源异常 · ${failures.length}`} subtitle="显示最后成功时间、最近失败原因和下次自动拉取时间。">
        {!resources.data?<p className="text-muted">正在读取状态…</p>:!failures.length?<p className="text-muted">当前没有资源拉取异常。</p>:<div className="flex flex-col gap-3">{failures.map((r,i)=><div key={i} className="rounded border border-line p-3 text-[13px]"><div className="font-medium">{r.name}</div><p className="text-red-600">{r.error} · {r.available?'正在使用旧缓存':'没有可用缓存'}</p><p className="text-muted">最后成功：{r.lastSuccessAt?formatTime(r.lastSuccessAt):'从未成功'} · 下次拉取：{r.nextFetchAt?formatTime(r.nextFetchAt):'待调度'}</p></div>)}</div>}
      </Card>
    </PageScroll></>;
}
