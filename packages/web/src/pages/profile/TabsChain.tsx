import { ChainCheckResult, useChainCheck } from './ChainCheck.tsx';
import { chainForLanding } from './ChainRuleEditor.tsx';
import { ChainRuleModal } from './ChainRuleModal.tsx';
import { profileModalData } from './modalProfile.ts';
import { useChainNames } from './useChainNames.ts';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import type { ReactNode } from 'react';
import { putChain } from './memberModel.ts';
import { persistedProfile } from './routing.ts';
import { CodePreview } from '../../components/CodePreview.tsx';
// 代理链直接展示业务检查结果，引用生成细节仅在配置预览中按需展开。

import { useMutation } from '@tanstack/react-query';
import { CLIENT_APPS, type ClientApp, type ChainResolution, type ChainRule, type Client } from '@sub-forge/core';
import { Link2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ProfilePreview } from '../../api.ts';
import type { ProfileDoc } from '../../hooks.ts';
import { Badge, Button, Card, Empty, ErrorAlert, ReportList, Segmented, Select } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

function usePreview() {
  const { draft } = useProfile();
  return useMutation({ mutationFn: ({ app, client = 'mihomo', profile = draft }: { app?: ClientApp; client?: Client; profile?: ProfileDoc } = {}) => api<ProfilePreview>('POST', draft.id ? `/profiles/${draft.id}/preview` : '/profiles/preview', { profile: persistedProfile(profile), client, ...(app ? { app } : {}) }) });
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
      <Card title="代理链"
        actions={<>{draft.chains.length > 0 && <Button size="sm" onClick={check.refresh} disabled={check.checking}>重新检查</Button>}<Button size="sm" onClick={add} disabled={!profileNodeSets.length}><Plus size={14} />添加代理链</Button></>}>
        {check.error && <div className="px-4"><ErrorAlert error={check.error} /></div>}
        {check.result && !check.result.ok && <p role="alert" className="m-0 mb-3 px-4 text-[13px] text-err">Mihomo 检查未通过。请在「预览」中选择实际客户端查看报告；各条代理链的问题显示在下方。</p>}
        {!draft.chains.length ? <div className="px-4 pb-4"><Empty title={profileNodeSets.length ? '还没有代理链' : '还没有节点集'} description={profileNodeSets.length ? undefined : '先在「节点集」中加入节点集。'} /></div> : (
          <div aria-label="代理链列表"><SortableList items={draft.chains} getKey={chain => chain.id} onReorder={chains => setDraft({ ...draft, chains })} renderItem={(chain, i, handle) => <ChainCard chain={chain} index={i} handle={handle} checking={check.checking} result={check.result?.chainResolutions?.find(r => r.chainId === chain.id)} onEdit={() => void edit(chain)} onDelete={() => setDraft({ ...draft, chains: draft.chains.filter(c => c.id !== chain.id) })} /> } /></div>
        )}
      </Card>

    </>
  );
}

function ChainCard({ chain, index, handle, checking, result, onEdit, onDelete }: { chain: ChainRule; index: number; handle: ReactNode; checking: boolean; result?: ChainResolution; onEdit: () => void; onDelete: () => void }) {
  const names = useChainNames(chain);
  const path = `${names.via} → ${names.landing}`;
  return <RoutingCard className="grid grid-cols-[24px_32px_minmax(0,1fr)_60px] md:grid-cols-[24px_32px_minmax(0,1fr)_minmax(0,0.6fr)_60px]">
    {handle}<RoutingCardIcon><Link2 size={16} /></RoutingCardIcon>
    <span title={path} className="min-w-0 truncate font-medium">{path}</span>
    <div className="col-span-2 col-start-3 row-start-2 min-w-0 md:col-auto md:row-auto"><ChainCheckResult chain={chain} checking={checking} result={result} /></div>
    <div className="col-start-4 row-start-1 md:col-start-5"><RoutingCardActions label={`代理链 ${index + 1}`} onEdit={onEdit} onDelete={onDelete} /></div>
  </RoutingCard>;
}

export function TabPreview() {
  const { draft } = useProfile();
  const preview = usePreview();
  const [app, setApp] = useState<ClientApp>();
  const [client, setClient] = useState<Client>('mihomo');
  const apps = CLIENT_APPS.filter(a => a.kernel === client);
  const target = { client, profile: persistedProfile(draft), ...(app ? { app } : {}) };
  const current = preview.data && !preview.isPending && !preview.error && JSON.stringify(preview.variables) === JSON.stringify(target);
  const report = preview.data?.report ?? [];
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
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="预览内核" value={client} options={[{ value: 'mihomo', label: 'mihomo' }, { value: 'stash', label: 'Stash' }, { value: 'surge', label: 'Surge' }, { value: 'loon', label: 'Loon' }]} onChange={(value) => { preview.reset(); setClient(value); setApp(undefined); }} />
        <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-2">客户端追加
          <Select clearable placeholder="选择客户端，留空仅应用内核公共追加" className="w-auto" value={app ?? ''} onChange={e => setApp(e.target.value ? e.target.value as ClientApp : undefined)}>{apps.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></label>
        <Button onClick={() => preview.mutate(target)} disabled={preview.isPending}>{preview.isPending ? '渲染中…' : '重新渲染'}</Button>
        <Button onClick={exportFile} disabled={!current || !preview.data?.ok || !preview.data?.yaml || !!preview.data.exportUnavailableReason}>导出文件</Button>
        <span className="text-[12.5px] text-ink-muted">当前草稿预览</span>
      </div>
      <ErrorAlert error={preview.error} />
      {preview.data && !current && !preview.isPending && <p role="status" className="text-[13px] text-ink-muted">配置已更改，请重新渲染预览。</p>}
      {client !== 'mihomo' && client !== 'loon' && <p className="text-[12.5px] text-ink-muted">节点随主订阅刷新更新；节点集内联输出，空策略组保持拒绝连接。导出文件会内嵌已转换的规则，可直接导入。</p>}
      {client === 'loon' && <p className="text-[12.5px] text-ink-muted">手写规则和规则集按列表顺序托管，最终兜底保留在主配置；节点随主订阅刷新更新。</p>}
      {current && preview.data.exportUnavailableReason && <p role="status" className="text-[13px] text-ink-muted">{preview.data.exportUnavailableReason}</p>}
      {current && (
        <div className="flex flex-wrap items-start gap-5">
          <CodePreview label="最终配置" className="flex-[999_1_560px] rounded-[10px]" title={`config.${preview.data.format === 'ini' ? 'conf' : 'yaml'} · ${preview.data.yaml?.split('\n').length ?? 0} 行`} text={preview.data.yaml ?? preview.data.failure ?? ''} copyable={!!preview.data.yaml} bodyClassName="max-h-[720px] p-4 text-[12.5px] leading-[1.75]" />
          <section aria-label="渲染报告" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[['错误', count('error'), 'text-err'], ['告警', count('warn'), 'text-warn'], ['提示', count('info'), 'text-accent-ink']].map(([t, n, c]) => (
                <div key={t as string} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-panel px-3 py-2.5"><span className="text-[12px] text-ink-muted">{t}</span><span className={`text-[22px] font-semibold ${c}`}>{n}</span></div>
              ))}
            </div>
            <Card title="渲染报告" bodyClass="px-4 pb-2">
              {!preview.data.ok && <div className="mb-2"><Badge tone="err">渲染失败，订阅接口会返回上一份成功结果</Badge></div>}
              <ReportList items={report} />
            </Card>
            <details className="rounded-lg border border-line bg-panel px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-medium">自动生成的引用详情（{preview.data.dependencies?.length ?? 0}）</summary>
              <p className="text-[12px] text-ink-muted">系统按客户端自动处理，以下为本次配置生成结果。</p>
              {!preview.data.dependencies?.length ? <p className="text-[12px] text-ink-muted">本次配置无需生成隐藏引用组。</p> : <ul className="m-0 list-none space-y-3 p-0">{preview.data.dependencies.map(d => <li key={d.refKey} className="border-t border-line-2 pt-2 text-[12px]">
                <div className="font-medium">{d.node}</div><div className="mt-1 break-all font-mono text-ink-muted">{d.output}</div><div className="mt-1 break-all text-ink-muted">引用位置：{d.usedBy.join('、')}</div>
              </li>)}</ul>}
            </details>
          </section>
        </div>
      )}
    </>
  );
}
