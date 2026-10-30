import { Frame } from '../modals/Frame.tsx';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import type { ResourceState } from '../components/ResourceCache.tsx';
import { Button,Card,ErrorAlert,Field,Input,PageHeader,PageScroll,formatTime } from '../components/ui.tsx';
type RuleResource = { key: string; name: string; target: { client: string }; referenced: boolean; error?: string };
export function System(){
  const qc=useQueryClient();const [hours,setHours]=useState<string>();
  const info=useQuery({queryKey:['system'],queryFn:()=>api<{resourceCacheTtlSec:number}>('GET','/system')});
  const resources=useQuery({queryKey:['system-resources'],queryFn:()=>api<{items:ResourceState[]}>('GET','/system/resources')});
  const rules=useQuery({queryKey:['shared-rule-resources'],queryFn:()=>api<{items:RuleResource[]}>('GET','/system/rule-resources')});
  const remove = (resource: RuleResource) => Frame.modal.confirm({ title: `删除公共规则资源「${resource.name}」？`, description: '此资源的旧下载链接会失效；不删除规则增强定义或其他客户端变体。配置再次使用时会重新生成。', confirmLabel: '删除资源', danger: true }, { submit: async () => {
    await api('DELETE', `/system/rule-resources/${resource.key}`);
    await qc.invalidateQueries({ queryKey: ['shared-rule-resources'] });
    await qc.invalidateQueries({ queryKey: ['system-resources'] });
  } });
  const save=useMutation({meta:{successMessage:'资源缓存设置已保存'},mutationFn:()=>api('PUT','/system',{resourceCacheTtlSec:Number(hours)*3600}),onSuccess:()=>{setHours(undefined);void qc.invalidateQueries();}});
  const value=hours??String((info.data?.resourceCacheTtlSec??86400)/3600);const valid=Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=8760;
  const failures=resources.data?.items.filter(r=>r.error)??[];
  return <><PageHeader title="系统" actions={<Button variant="primary" disabled={hours===undefined||!valid||save.isPending||!info.data} onClick={()=>save.mutate()}>{save.isPending?'保存中…':'保存'}</Button>}/>
    <ErrorAlert error={info.error??save.error??resources.error}/><PageScroll>
      <Card title="资源缓存" subtitle="节点、规则、仓库索引及客户端更新间隔统一使用此设置。">
        <div className="flex max-w-[620px] flex-col gap-4">
          <Field label="资源缓存时间（小时）">{id=><Input placeholder="资源自动更新间隔，单位为小时，范围 1 至 8760" id={id} type="number" min={1} max={8760} step={1} value={value} onChange={e=>setHours(e.target.value)} />}</Field>
          {!valid&&<p className="text-[13px] text-red-600">请输入 1 至 8760 的整数小时。</p>}
          <p className="text-[13px] leading-relaxed text-ink-muted">每个资源只保留最后一次成功内容。到期自动拉取，失败时保留旧内容并延后一个周期再次尝试；列表中的“刷新缓存”可立即重新拉取。</p>
          <p className="text-[13px] text-ink-muted">设置保存后立即应用于服务端。客户端更新间隔在其下次下载配置后生效。</p>
        </div>
      </Card>
      <Card title={`资源异常 · ${failures.length}`} subtitle="显示最后成功时间、最近失败原因和下次自动拉取时间。">
        {!resources.data?<p className="text-ink-muted">正在读取状态…</p>:!failures.length?<p className="text-ink-muted">当前没有资源拉取异常。</p>:<div className="flex flex-col gap-3">{failures.map((r,i)=><div key={i} className="rounded border border-line p-3 text-[13px]"><div className="font-medium">{r.name}</div><p className="text-red-600">{r.error} · {r.available?'正在使用旧缓存':'没有可用缓存'}</p><p className="text-ink-muted">最后成功：{r.lastSuccessAt?formatTime(r.lastSuccessAt):'从未成功'} · 下次拉取：{r.nextFetchAt?formatTime(r.nextFetchAt):'待调度'}</p></div>)}</div>}
      </Card>
      <Card title="公共规则资源" subtitle="由所有有效用户令牌共享。删除订阅不删除这里的资源；可清理已无配置或模板引用的产物。">
        <ErrorAlert error={rules.error} />
        {!rules.data ? <p className="text-ink-muted">正在读取公共资源…</p> : !rules.data.items.length ? <p className="text-ink-muted">尚未生成公共规则资源。</p> : <ul className="flex list-none flex-col gap-3 p-0">{rules.data.items.map(resource => <li key={resource.key} className="flex items-center justify-between gap-4 rounded border border-line p-3 text-[13px]">
          <div className="min-w-0"><div className="break-all font-medium">{resource.name}</div><div className="text-ink-muted">{resource.target.client} · {resource.referenced ? '仍被引用' : '无配置引用'}</div>{resource.error && <p className="text-red-600">{resource.error} · 正在使用上次成功产物</p>}</div>
          <Button size="sm" variant="danger" disabled={resource.referenced} onClick={() => void remove(resource)}>删除资源</Button>
        </li>)}</ul>}
      </Card>
    </PageScroll></>;
}
