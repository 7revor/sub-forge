import { ChainCheckResult, useChainCheck } from './ChainCheck.tsx';
import { chainForLanding } from './ChainRuleEditor.tsx';
import { ChainRuleModal } from './ChainRuleModal.tsx';
import { profileModalData } from './modalProfile.ts';
import { useChainNames } from './useChainNames.ts';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import type { ReactNode } from 'react';
import { putChain } from './memberModel.ts';
import { CodePreview, type CodeRange } from '../../components/CodePreview.tsx';
import { PreviewReport } from './PreviewReport.tsx';
import { indexPreview, locatePreviewIssue } from './previewReport.ts';
// 代理链直接展示业务检查结果，引用生成细节仅在配置预览中按需展开。

import { useMutation } from '@tanstack/react-query';
import { BASE_KERNELS, baseKernel, BASE_CLIENT_APPS, type BaseKernel, type ClientApp, type ChainResolution, type ChainRule, type Client } from '@sub-forge/core';
import { ArrowRight, Link2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type ProfilePreview } from '../../api.ts';
import type { ProfileDoc } from '../../hooks.ts';
import { Badge, Button, Card, Empty, ErrorAlert, Segmented, Select } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

function usePreview() {
  const { draft } = useProfile();
  return useMutation({ mutationFn: ({ app, client = 'mihomo', profile = draft }: { app?: ClientApp; client?: Client; profile?: ProfileDoc } = {}) => api<ProfilePreview>('POST', draft.id ? `/profiles/${draft.id}/preview` : '/profiles/preview', { profile: profile, client, ...(app ? { app } : {}) }) });
}

export function TabChains() {
  const profile = useProfile();
  const { draft, setDraft, profileNodeSets } = profile;
  const check = useChainCheck();
  const edit = async (chain: ChainRule, adding = false) => {
    const result = await ChainRuleModal.show({ ...profileModalData(profile), chain, title: adding ? '添加代理链' : '编辑代理链' });
    if (result.status === 'confirmed' && result.data) setDraft({ ...draft, chains: putChain(draft.chains, result.data) });
  };
  const add = () => void edit(chainForLanding([], { nodeSet: { type: 'source', id: '' } }), true);

  return (
    <>
      <Card title="代理链" count={draft.chains.length}
        actions={<>{draft.chains.length > 0 && <Button variant="ghost" onClick={check.refresh} disabled={check.checking}>重新检查</Button>}<Button onClick={add} disabled={!profileNodeSets.length}><Plus size={14} />添加代理链</Button></>}>
        {check.error && <div className="px-4"><ErrorAlert error={check.error} /></div>}
        {check.result && !check.result.ok && <p role="alert" className="m-0 mb-3 px-4 text-sm text-destructive">Mihomo 检查未通过。请在「预览」中选择实际客户端查看报告；各条代理链的问题显示在下方。</p>}
        {!draft.chains.length ? <Empty variant="card" title={profileNodeSets.length ? '还没有代理链' : '先添加节点来源，再配置代理链'} /> : (
          <div aria-label="代理链列表"><SortableList items={draft.chains} getKey={chain => chain.id} onReorder={chains => setDraft({ ...draft, chains })} renderItem={(chain, i, handle) => <ChainCard chain={chain} index={i} handle={handle} checking={check.checking} result={check.result?.chainResolutions?.find(r => r.chainId === chain.id)} onEdit={() => void edit(chain)} onDelete={() => setDraft({ ...draft, chains: draft.chains.filter(c => c.id !== chain.id) })} /> } /></div>
        )}
      </Card>

    </>
  );
}

function ChainCard({ chain, index, handle, checking, result, onEdit, onDelete }: { chain: ChainRule; index: number; handle: ReactNode; checking: boolean; result?: ChainResolution; onEdit: () => void; onDelete: () => void }) {
  const names = useChainNames(chain);
  const path = `${names.via} → ${names.landing}`;
  return <RoutingCard className="grid grid-cols-[20px_32px_minmax(0,1fr)_64px] lg:grid-cols-[20px_32px_minmax(0,1fr)_132px_128px_64px]">
    {handle}<RoutingCardIcon><Link2 size={16} /></RoutingCardIcon>
    <span title={path} className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 truncate rounded-md bg-muted px-2.5 py-1 font-medium">{names.via}</span><ArrowRight size={14} className="text-muted-foreground" /><span className="min-w-0 truncate rounded-md bg-muted px-2.5 py-1 font-medium">{names.landing}</span></span>
    <div className="col-span-2 col-start-3 row-start-2 min-w-0 lg:col-auto lg:row-auto"><ChainCheckResult chain={chain} checking={checking} result={result} /></div>
    <span className="hidden lg:block" aria-hidden /><div className="col-start-4 row-start-1 lg:col-start-6"><RoutingCardActions label={`代理链 ${index + 1}`} onEdit={onEdit} onDelete={onDelete} /></div>
  </RoutingCard>;
}

export function TabPreview() {
  const { draft, groups } = useProfile();
  const preview = usePreview();
  const [located, setLocated] = useState<{ result: ProfilePreview; index: number; range: CodeRange }>();
  const [app, setApp] = useState<ClientApp>();
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [kernel, setKernel] = useState<BaseKernel>('mihomo');
  const apps = BASE_CLIENT_APPS.filter(a => baseKernel(a.kernel) === kernel);
  const client = apps.find(a => a.id === app)?.kernel ?? kernel;
  const target = { client, profile: draft, ...(app ? { app } : {}) };
  const current = preview.data && !preview.isPending && !preview.error && JSON.stringify(preview.variables) === JSON.stringify(target);
  const report = preview.data?.report ?? [];
  const filtered = report.map((item, index) => ({ item, index })).filter(({ item }) => level === 'all' || item.level === level);
  const outputIndex = useMemo(() => indexPreview(preview.data?.yaml ?? '', preview.data?.format), [preview.data]);
  const locations = report.map(item => locatePreviewIssue(item, outputIndex, groups));
  const selection = located?.result === preview.data ? located : undefined;
  const count = (l: string) => report.filter((r) => r.level === l).length;
  // 打开标签或切换内核、客户端时自动渲染当前草稿
  useEffect(() => { preview.mutate(target); }, [client, app]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportFile = () => {
    const yaml = preview.data?.exportYaml ?? preview.data?.yaml;
    if (!yaml || !current || !preview.data?.ok || preview.data.exportUnavailableReason) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([yaml], { type: preview.data?.format === 'ini' ? 'text/plain' : 'text/yaml' }));
    a.download = `${draft.name || 'config'}.${preview.data?.format === 'ini' ? 'conf' : 'yaml'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Segmented label="预览内核" value={kernel} options={[...BASE_KERNELS]} onChange={(value) => { preview.reset(); setKernel(value); setApp(undefined); }} />
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-foreground"><span className="sr-only">客户端追加</span>
          <Select clearable placeholder="全部客户端（只用内核公共追加）" className="w-[260px]" value={app ?? ''} onChange={e => setApp(e.target.value ? e.target.value as ClientApp : undefined)}>{apps.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></label>
        <span className="mr-auto text-xs text-muted-foreground">包含当前未保存的修改</span>
        <Button variant="ghost" onClick={() => preview.mutate(target)} disabled={preview.isPending}>{preview.isPending ? '渲染中…' : '重新生成'}</Button>
        <Button onClick={exportFile} disabled={!current || !preview.data?.ok || !preview.data?.yaml || !!preview.data.exportUnavailableReason}>下载配置文件</Button>
      </div>
      <ErrorAlert error={preview.error} />
      {preview.data && !current && !preview.isPending && <p role="status" className="text-sm text-muted-foreground">配置已更改，请重新生成预览。</p>}
      <p className="text-sm text-muted-foreground">引用来源通过远程订阅更新；展开来源随主订阅更新。空策略组保持拒绝连接。</p>
      {client === 'loon' && <p className="text-sm text-muted-foreground">本地规则和规则集按列表顺序托管，最终兜底保留在主配置。</p>}
      {current && preview.data.exportUnavailableReason && <p role="status" className="text-sm text-muted-foreground">{preview.data.exportUnavailableReason}</p>}
      {current && (
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
          <CodePreview fill lineNumbers label="最终配置" className="rounded-xl" title={<>{`config.${preview.data.format === 'ini' ? 'conf' : 'yaml'} · ${preview.data.yaml?.split('\n').length ?? 0} 行`}{selection && <span role="status" className="ml-3 text-[#b8ccff]">已定位第 {selection.range.startLine} 行</span>}</>} text={preview.data.yaml ?? preview.data.failure ?? ''} highlight={selection?.range} bodyClassName="overscroll-contain p-4 text-sm leading-[22px]" />
          <section aria-label="渲染报告" tabIndex={0} className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border bg-card shadow-sm [overflow-wrap:anywhere]">
            <div className="flex items-center justify-between px-5 pt-4"><h2 className="m-0 text-base font-semibold">检查结果</h2><Badge tone={preview.data.ok ? 'ok' : 'err'}>{preview.data.ok ? (preview.data.exportUnavailableReason ? '生成成功' : '可以导入') : '渲染失败'}</Badge></div>
            <div className="px-5"><Segmented fullWidth label="筛选检查结果" value={level} onChange={setLevel} options={[{ value: 'all', label: `全部 ${report.length}` }, { value: 'error', label: `错误 ${count('error')}` }, { value: 'warn', label: `告警 ${count('warn')}` }, { value: 'info', label: `提示 ${count('info')}` }]} /></div>
            <div className="min-h-0 flex-1 overflow-auto border-t border-border">
              <PreviewReport items={filtered.map(item => item.item)} locations={filtered.map(item => locations[item.index])} selected={filtered.findIndex(item => item.index === selection?.index)} onLocate={index => { const original = filtered[index]!.index; const range = locations[original]; if (range) setLocated({ result: preview.data, index: original, range: { ...range } }); }} />
            </div>
            <details className="group border-t border-border px-5 py-3">
              <summary className="flex h-7 cursor-pointer list-none items-center justify-between text-xs text-muted-foreground [&::-webkit-details-marker]:hidden"><span>自动生成的引用 {preview.data.dependencies?.length ?? 0} 个</span><span className="font-medium group-open:hidden">查看</span><span className="hidden font-medium group-open:inline">收起</span></summary>
              <p className="text-xs text-muted-foreground">系统按客户端自动处理，以下为本次配置生成结果。</p>
              {!preview.data.dependencies?.length ? <p className="text-xs text-muted-foreground">本次配置无需生成隐藏引用组。</p> : <ul className="m-0 list-none space-y-3 p-0">{preview.data.dependencies.map(d => <li key={d.refKey} className="border-t border-border pt-2 text-xs">
                <div className="font-medium">{d.node}</div><div className="mt-1 break-all font-mono text-muted-foreground">{d.output}</div><div className="mt-1 break-all text-muted-foreground">引用位置：{d.usedBy.join('、')}</div>
              </li>)}</ul>}
            </details>
          </section>
        </div>
      )}
    </>
  );
}
