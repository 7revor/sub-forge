import { Frame } from '../modals/Frame.tsx';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { BackupSettings } from '../components/BackupSettings.tsx';
import { Pagination } from '../components/Pagination.tsx';
import type { PageResult } from '../hooks/usePagedList.ts';
import { RefreshCacheButton, type ResourceState } from '../components/ResourceCache.tsx';
import { Badge,Button,Card,ErrorAlert,Field,Input,PageHeader,PageScroll,formatTime } from '../components/ui.tsx';
type RuleResource = { key: string; name: string; target: { client: string }; referenced: boolean; error?: string };
function RetryResource({resource:r}:{resource:ResourceState}) {
  const qc=useQueryClient();
  const retry=useMutation({mutationFn:()=>api('POST',`/rule-repos/${r.repositoryId}/refresh`,{}),onSuccess:()=>qc.invalidateQueries({queryKey:['system-resources']})});
  return r.resource ? <RefreshCacheButton kind="system-resource" id={r.resource} name={r.name} label="立即重试" endpoint={`/system/resources/${encodeURIComponent(r.resource)}/refresh`} disabled={r.refreshing}/> : r.repositoryId ? <Button size="sm" disabled={retry.isPending||r.refreshing} onClick={()=>retry.mutate()}>{retry.isPending||r.refreshing?'重试中…':'立即重试'}</Button> : null;
}
export function System(){
  const qc=useQueryClient();const [hours,setHours]=useState<string>();const [rulePage,setRulePage]=useState(1);const [rulePageSize,setRulePageSize]=useState(10);
  const info=useQuery({queryKey:['system'],queryFn:()=>api<{resourceCacheTtlSec:number}>('GET','/system')});
  const resources=useQuery({queryKey:['system-resources'],queryFn:()=>api<{items:ResourceState[]}>('GET','/system/resources')});
  const rules=useQuery({queryKey:['shared-rule-resources',{page:rulePage,pageSize:rulePageSize}],placeholderData:previous=>previous,queryFn:()=>api<PageResult<RuleResource>>('GET',`/system/rule-resources?${new URLSearchParams({page:String(rulePage),pageSize:String(rulePageSize)})}`)});
  const remove = (resource: RuleResource) => Frame.modal.confirm({ title: `删除公共规则资源「${resource.name}」？`, description: '此资源的旧下载链接会失效；不删除规则增强定义或其他客户端变体。配置再次使用时会重新生成。', confirmLabel: '删除资源', danger: true }, { submit: async () => {
    await api('DELETE', `/system/rule-resources/${resource.key}`);
    await qc.invalidateQueries({ queryKey: ['shared-rule-resources'] });
    await qc.invalidateQueries({ queryKey: ['system-resources'] });
  } });
  const save=useMutation({meta:{successMessage:'资源缓存设置已保存'},mutationFn:()=>api('PUT','/system',{resourceCacheTtlSec:Number(hours)*3600}),onSuccess:()=>{setHours(undefined);void qc.invalidateQueries();}});
  const value=hours??String((info.data?.resourceCacheTtlSec??86400)/3600);const valid=Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=8760;
  const failures=resources.data?.items.filter(r=>r.error)??[];
  return <><PageHeader title="系统" actions={<Button variant="primary" disabled={hours===undefined||!valid||save.isPending||!info.data} onClick={()=>save.mutate()}>{save.isPending?'保存中…':hours===undefined?'已保存':'保存'}</Button>}/>
    <ErrorAlert error={info.error??save.error??resources.error}/><PageScroll>
      <section className="settings-panel"><div className="settings-row"><div><h2>资源缓存</h2><p>节点、规则、仓库索引与客户端更新间隔共用</p></div><div className="flex max-w-lg flex-col gap-2">
        <div className="flex max-w-[360px] items-center"><Input className="rounded-r-none" aria-label="资源缓存时间（小时）" placeholder="填写缓存小时数，1 至 8760" type="number" min={1} max={8760} step={1} value={value} onChange={event=>setHours(event.target.value)} /><span className="flex h-9 shrink-0 items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">小时</span></div>
        {!valid && <span className="text-sm text-destructive">请输入 1 至 8760 的整数小时。</span>}<p>到期自动重新拉取；失败时继续使用旧内容。</p>
      </div></div>
      <div className="settings-row"><div><h2 className="flex items-center gap-1.5">资源异常 <Badge tone="err" className="h-5">{failures.length}</Badge></h2><p>最近失败的资源与下次自动拉取时间</p></div><div>
        {!resources.data?<p className="text-muted-foreground">正在读取状态…</p>:!failures.length?<p className="text-muted-foreground">当前没有资源拉取异常。</p>:<div className="flex flex-col gap-3">{failures.map((r,i)=><div key={i} className="rounded-lg border border-border px-3 py-2.5 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium">{r.name}</span><RetryResource resource={r}/></div><p className="text-red-600">{r.error} · {r.available?'正在使用旧缓存':'没有可用缓存'}</p><p className="text-muted-foreground">最后成功：{r.lastSuccessAt?formatTime(r.lastSuccessAt):'从未成功'} · 下次拉取：{r.nextFetchAt?formatTime(r.nextFetchAt):'待调度'}</p></div>)}</div>}
      </div></div>
      <div className="settings-row"><div><h2>公共规则资源</h2><p>所有用户令牌可读；可清理无人引用的产物</p></div><div>
        <ErrorAlert error={rules.error} />
        {!rules.data ? <p className="text-muted-foreground">正在读取公共资源…</p> : !rules.data.total ? <p className="text-muted-foreground">尚未生成公共规则资源。</p> : <ul className="flex list-none flex-col p-0">{rules.data.items.map(resource => <li key={resource.key} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0 text-sm">
          <div className="min-w-0"><div className="break-all font-medium">{resource.name}</div><div className="text-muted-foreground">{resource.target.client} · {resource.referenced ? '仍被引用' : '无配置引用'}</div>{resource.error && <p className="text-red-600">{resource.error} · 正在使用上次成功产物</p>}</div>
          <Button size="sm" variant="danger" disabled={resource.referenced} onClick={() => void remove(resource)}>删除资源</Button>
        </li>)}</ul>}
        {!!rules.data?.total && <Pagination className="!px-0 !pb-0" page={rules.data.page} pageSize={rules.data.pageSize} total={rules.data.total} totalPages={rules.data.totalPages} busy={rules.isFetching} onPage={setRulePage} onPageSize={value=>{setRulePageSize(value);setRulePage(1);}} />}
      </div></div>
      <BackupSettings />
    </section></PageScroll></>;
}
