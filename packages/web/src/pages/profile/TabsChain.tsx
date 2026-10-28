// 代理链（链规则 + 依赖节点面板，REF-03 / REF-07）与预览（按平台查看最终配置与渲染报告）。

import { useMutation } from '@tanstack/react-query';
import type { ChainRule, Platform, RefStrategy } from '@sub-forge/core';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type ProfilePreview } from '../../api.ts';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { NodeSetSelect, TargetPicker, targetLabel } from '../../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, ReportList, Segmented, Select, td, th } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

const STRATEGIES: { value: RefStrategy; label: string }[] = [{ value: 'wrap', label: '包装组' }, { value: 'copy', label: '复制到本地' }, { value: 'inline', label: '整体内联' }];

function usePreview() {
  const { draft } = useProfile();
  return useMutation({ mutationFn: (platform?: Platform) => api<ProfilePreview>('POST', `/profiles/${draft.id}/preview`, { profile: draft, ...(platform ? { platform } : {}) }) });
}

function Hop({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-lg border bg-panel px-3 py-2 ${accent ? 'border-[#a9bbea]' : 'border-[#d5d9e0]'}`}>
      <span className="text-[11.5px] text-muted">{k}</span><span className="text-[13px] font-medium">{v}</span>
    </div>
  );
}

export function TabChains() {
  const { draft, setDraft, groupOptions, groupName, profileNodeSets, nodeSetName } = useProfile();
  const preview = usePreview();
  const setChain = (i: number, c: ChainRule) => setDraft({ ...draft, chains: draft.chains.map((x, j) => (j === i ? c : x)) });
  const add = () => {
    const ns = profileNodeSets[0]?.ref;
    if (!ns) return;
    setDraft({ ...draft, chains: [...draft.chains, { id: `c_${Date.now().toString(36)}`, landing: { nodeSet: ns }, via: { kind: 'group', groupId: groupOptions[0]?.id ?? '' } }] });
  };
  const perRef = draft.refPolicy.perRef ?? {};
  const chainReport = (preview.data?.report ?? []).filter((r) =>
    (r.level === 'warn' || r.level === 'error') && (r.code.startsWith('chain.') || r.code.startsWith('ref.')));

  return (
    <>
      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">链规则</h2><span className="text-[12.5px] text-muted">落地 = 某节点集中命中筛选的节点 → 前置 = 策略组或单个节点。provider 中的节点不需要打平。</span></div>}
        actions={<Button onClick={add} disabled={!profileNodeSets.length}><Plus size={15} />添加链规则</Button>}>
        {!draft.chains.length ? <Empty>{profileNodeSets.length ? '还没有链规则。' : '先在「节点集」中加入节点集。'}</Empty> : (
          <div className="flex flex-col gap-3">
            {draft.chains.map((c, i) => (
              <div key={c.id} className="flex flex-col gap-3 rounded-[10px] border border-line bg-[#fafbfc] p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Hop k="客户端" v="本机" />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k="前置" v={targetLabel(c.via, groupName, nodeSetName)} accent />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k={`落地 · ${nodeSetName(c.landing.nodeSet)}`} v={c.landing.filter || c.landing.excludeFilter ? `筛选 ${c.landing.filter ?? ''}${c.landing.excludeFilter ? ` 排除 ${c.landing.excludeFilter}` : ''}` : '全部节点'} />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k="目标" v="互联网" />
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={`删除链规则 ${i + 1}`} onClick={() => setDraft({ ...draft, chains: draft.chains.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                  <Field label="落地节点集">{() => <NodeSetSelect label="落地节点集" value={c.landing.nodeSet} options={profileNodeSets} onChange={(nodeSet) => setChain(i, { ...c, landing: { ...c.landing, nodeSet } })} />}</Field>
                  <Field label="落地筛选（正则，留空为全部）">{(id) => <Input id={id} className="font-mono" value={c.landing.filter ?? ''} onChange={(e) => setChain(i, { ...c, landing: { ...c.landing, filter: e.target.value || undefined } })} />}</Field>
                  <Field label="排除（正则）">{(id) => <Input id={id} className="font-mono" value={c.landing.excludeFilter ?? ''} onChange={(e) => setChain(i, { ...c, landing: { ...c.landing, excludeFilter: e.target.value || undefined } })} />}</Field>
                </div>
                <MatchPreview nodeSet={c.landing.nodeSet} filter={c.landing.filter} excludeFilter={c.landing.excludeFilter} />
                <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">前置</span>
                  <TargetPicker label="前置" value={c.via} onChange={(via) => setChain(i, { ...c, via })} groups={groupOptions} nodeSets={profileNodeSets} /></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {chainReport.length > 0 && <Card title="代理链告警" bodyClass="px-4 pb-2"><ReportList items={chainReport} /></Card>}
      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">依赖节点</h2><span className="text-[12.5px] text-muted">系统自动引入的包装组与复制节点。默认包装组（不打平、不复制），也可以逐项切换。</span></div>}
        actions={<>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">Profile 默认
            <Select className="h-9 w-auto" value={draft.refPolicy.default} onChange={(e) => setDraft({ ...draft, refPolicy: { ...draft.refPolicy, default: e.target.value as RefStrategy } })}>
              {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select></label>
          <Button onClick={() => preview.mutate(undefined)} disabled={preview.isPending}>{preview.isPending ? '解析中…' : '解析依赖'}</Button>
        </>} bodyClass="overflow-x-auto">
        <ErrorBox error={preview.error} />
        {!preview.data ? <div className="px-4 pb-4"><Empty>点「解析依赖」用当前草稿试渲染，列出被引用的 provider 节点。</Empty></div> : !preview.data.dependencies?.length ? <div className="px-4 pb-4"><Empty>没有引用 provider 中的单个节点。</Empty></div> : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr><th className={th}>被引用的节点</th><th className={th}>生成项</th><th className={th}>引用来源</th><th className={th}>解析策略</th></tr></thead>
            <tbody>
              {preview.data.dependencies.map((d) => (
                <tr key={d.refKey}>
                  <td className={td}><div className="flex flex-col gap-0.5"><span className="font-medium">{d.node}</span><span className="text-[12px] text-muted">{d.nodeSet}</span></div></td>
                  <td className={`${td} font-mono text-[12.5px]`}>{d.output}</td>
                  <td className={`${td} text-[12.5px] text-ink-2`}>{d.usedBy.join('、')}</td>
                  <td className={td}><Segmented label="解析策略" value={perRef[d.refKey] ?? draft.refPolicy.default} options={STRATEGIES}
                    onChange={(v) => setDraft({ ...draft, refPolicy: { ...draft.refPolicy, perRef: { ...perRef, [d.refKey]: v } } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview.data && <p className="mx-4 mt-3 mb-0 text-[12.5px] leading-relaxed text-muted">包装组一律输出 <code className="font-mono">empty-fallback: REJECT</code>：provider 未加载或节点消失时拒绝连接，不会绕过前置直连。</p>}
      </Card>
    </>
  );
}

const PLATFORMS: { value: Platform | 'any'; label: string }[] = [{ value: 'any', label: '不区分' }, { value: 'macos', label: 'macOS' }, { value: 'windows', label: 'Windows' }, { value: 'android', label: 'Android' }, { value: 'linux', label: 'Linux' }];

export function TabPreview() {
  const preview = usePreview();
  const [platform, setPlatform] = useState<Platform | 'any'>('any');
  const report = preview.data?.report ?? [];
  const count = (l: string) => report.filter((r) => r.level === l).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="客户端" value="mihomo" options={[{ value: 'mihomo', label: 'mihomo' }]} onChange={() => {}} />
        <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-2">平台
          <Select className="w-auto" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'any')}>{PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></label>
        <Button variant="primary" onClick={() => preview.mutate(platform === 'any' ? undefined : platform)} disabled={preview.isPending}>{preview.isPending ? '渲染中…' : '渲染预览'}</Button>
        <span className="text-[12.5px] text-muted">用当前草稿（含未保存的修改）渲染，不影响已下发的订阅。Surge 在 M2。</span>
      </div>
      <ErrorBox error={preview.error} />
      {preview.data && (
        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="最终配置" className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-[10px] bg-nav">
            <div className="flex items-center justify-between border-b border-[#262b33] px-4 py-2.5">
              <span className="font-mono text-[12.5px] text-nav-text">config.yaml · {preview.data.yaml?.split('\n').length ?? 0} 行</span>
              {preview.data.yaml && <Button size="sm" variant="ghost" className="text-nav-text hover:bg-nav-hover" onClick={() => navigator.clipboard?.writeText(preview.data!.yaml!)}>复制</Button>}
            </div>
            <pre className="m-0 max-h-[720px] overflow-auto p-4 font-mono text-[12.5px] leading-[1.75] text-[#dde1e7]">{preview.data.yaml ?? preview.data.failure}</pre>
          </section>
          <section aria-label="渲染报告" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[['错误', count('error'), 'text-err'], ['告警', count('warn'), 'text-warn'], ['提示', count('info'), 'text-accent-ink']].map(([t, n, c]) => (
                <div key={t as string} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-panel px-3 py-2.5"><span className="text-[12px] text-muted">{t}</span><span className={`text-[22px] font-semibold ${c}`}>{n}</span></div>
              ))}
            </div>
            <Card title="渲染报告" bodyClass="px-4 pb-2">
              {!preview.data.ok && <div className="mb-2"><Badge tone="err">渲染失败，订阅接口会返回上一份成功结果</Badge></div>}
              <ReportList items={report} />
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
