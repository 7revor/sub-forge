import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChainRule, NodeSetID, Target } from '@sub-forge/core';
import { useNodeList } from '../../hooks.ts';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { resolveRef } from '../../components/nodeMatch.ts';
import { targetLabel } from '../../components/pickers.tsx';
import { Button, Empty, Field, Input, Segmented, Select } from '../../components/ui.tsx';
import { chainPlaceholders } from '../../schemas/placeholders.ts';
import { useProfile } from './context.ts';
import { chainInputError, exactNodeFilter, nodeSetKey, sameLanding } from './memberModel.ts';
import { landingNodeName } from './chainModel.ts';

type SourceKind = 'inline' | 'provider';
const emptySet: NodeSetID = { type: 'source', id: '' };
const emptyVia = (kind: SourceKind, nodeSet = emptySet): Target => ({ kind: 'node', ref: { nodeSet, match: kind === 'provider' ? { regex: '' } : { exact: '' }, fallback: 'error' } });

function InlineNodes({ nodeSet, selected, label, onSelect }: { nodeSet?: NodeSetID; selected?: string; label: string; onSelect: (name: string) => void }) {
  const [search, setSearch] = useState('');
  const nodes = useNodeList(nodeSet, useDebouncedValue(search, 200));
  return <>
    <Field label={`搜索${label}`}>{id => <Input id={id} disabled={!nodeSet} placeholder={`输入名称查找${label}，再点选一个节点`} value={search} onChange={e => setSearch(e.target.value)} />}</Field>
    {nodeSet && <div aria-label={`${label}候选`} className="max-h-36 overflow-y-auto rounded-md border border-line">
      {nodes.error && <div role="alert" className="p-3 text-[12px] text-err">节点加载失败：{nodes.error.message}<Button size="sm" variant="ghost" onClick={() => void nodes.refetch()}>重新加载</Button></div>}
      {nodes.isLoading && <p className="px-3 text-[13px] text-ink-muted">正在加载节点…</p>}
      {nodes.data?.nodes.map(n => <button type="button" key={n.name} aria-pressed={selected === n.name} onClick={() => onSelect(n.name)} className="flex w-full cursor-pointer items-center justify-between gap-2 border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-ground aria-pressed:bg-accent-soft aria-pressed:text-brand"><span className="break-all">{n.name}</span><span className="shrink-0 text-[11px] text-ink-muted">{selected === n.name ? '已选' : n.type.toUpperCase()}</span></button>)}
      {nodes.data && !nodes.data.nodes.length && <Empty variant="plain" title="没有匹配节点" />}
      {nodes.data?.truncated && <p className="px-3 text-[12px] text-ink-muted">结果较多，请搜索缩小范围。</p>}
    </div>}
    {selected && <p className="m-0 break-all text-[12px] text-brand">已选：{selected}</p>}
  </>;
}

function ProviderMatch({ via }: { via: Extract<Target, { kind: 'node' }> }) {
  const nodes = useNodeList(via.ref.nodeSet);
  const pattern = 'regex' in via.ref.match ? via.ref.match.regex : exactNodeFilter(via.ref.match.exact);
  const result = resolveRef(nodes.data?.nodes ?? [], via.ref.match);
  return <div aria-live="polite" className="rounded-md bg-ground px-3 py-2 text-[12px] leading-relaxed">
    {!via.ref.nodeSet.id ? '选择 Provider 后输入筛选条件。' : !pattern ? '输入节点名称关键词或正则表达式，查看实际采用的前置。' : nodes.isLoading ? '正在读取前置节点…' : nodes.error ? <span className="text-err">读取失败：{nodes.error.message}<Button variant="ghost" size="sm" onClick={() => void nodes.refetch()}>重新加载</Button></span> : result.error ? <span className="text-err">{result.error}</span> : nodes.data && <>
      <div>{nodes.data.truncated ? '当前列表' : ''}命中 {result.count} 个{result.node && <> · 当前采用：<strong>{result.node.name}</strong></>}</div>
      <div className="text-ink-muted">{nodes.data.truncated ? '列表已截断，最终结果以配置预览为准。' : '按节点顺序使用首个匹配项；没有匹配时拒绝连接。'}</div>
    </>}
  </div>;
}

/** 编辑顺序与流量方向一致；前置与落地各自选择，整集设置只由代理链入口创建。 */
export function ChainRuleEditor({ initial, fixedLanding = false, landingLabel, onApply, onCancel, onRemove, footerTarget }: {
  initial: ChainRule; fixedLanding?: boolean; landingLabel?: string; onApply: (chain: ChainRule) => void; onCancel: () => void; onRemove?: () => void; footerTarget?: HTMLDivElement | null;
}) {
  const { draft, profileNodeSets, groupOptions, groupName, nodeSetName } = useProfile();
  const outputOf = (ref: NodeSetID) => draft.nodeSets.find(s => nodeSetKey(s.ref) === nodeSetKey(ref))?.output;
  const [chain, setChain] = useState(initial);
  const [kind, setKind] = useState<SourceKind | 'group' | 'direct'>(() => initial.via.kind === 'group' ? 'group' : initial.via.kind === 'builtin' ? 'direct' : outputOf(initial.via.ref.nodeSet) ?? (draft.nodeSets.some(s => s.output === 'provider') ? 'provider' : 'inline'));
  const [landingKind, setLandingKind] = useState<SourceKind>(outputOf(initial.landing.nodeSet) ?? (draft.nodeSets.some(s => s.output === 'provider') ? 'provider' : 'inline'));
  // 历史整集 Inline / Provider 局部筛选保留原范围，不能在打开弹窗时静默扩大或缩小。
  const [legacyLanding, setLegacyLanding] = useState(!!initial.landing.nodeSet.id && (outputOf(initial.landing.nodeSet) === 'provider' ? !!(initial.landing.filter || initial.landing.excludeFilter) : !landingNodeName(initial.landing)));
  const sourcesFor = (output: SourceKind) => profileNodeSets.filter(s => outputOf(s.ref) === output);
  const sources = kind === 'provider' || kind === 'inline' ? sourcesFor(kind) : [];
  const active = chain.via.kind === 'node' ? sources.find(s => nodeSetKey(s.ref) === nodeSetKey(chain.via.kind === 'node' ? chain.via.ref.nodeSet : emptySet)) : undefined;
  const landingSource = sourcesFor(landingKind).find(s => nodeSetKey(s.ref) === nodeSetKey(chain.landing.nodeSet));
  const whole = !chain.landing.filter && !chain.landing.excludeFilter;
  const overridden = !whole && draft.chains.some(c => c.id !== chain.id && nodeSetKey(c.landing.nodeSet) === nodeSetKey(chain.landing.nodeSet) && !c.landing.filter && !c.landing.excludeFilter);
  const error = chainInputError(chain) ?? (!fixedLanding && !legacyLanding && landingKind === 'inline' && !landingNodeName(chain.landing) ? '请选择一个 Inline 落地节点' : undefined) ?? (draft.chains.some(c => c.id !== chain.id && sameLanding(c.landing, chain.landing)) ? '该落地范围已有代理链，请编辑已有规则' : undefined);
  const viaFilter = chain.via.kind === 'node' ? ('regex' in chain.via.ref.match ? chain.via.ref.match.regex : chain.via.ref.match.exact ? exactNodeFilter(chain.via.ref.match.exact) : '') : '';
  const choose = (via: Target) => setChain({ ...chain, via });
  const viaLabel = chain.via.kind === 'group' ? (chain.via.groupId ? groupName(chain.via.groupId) : '待选前置') : chain.via.kind === 'node' ? (chain.via.ref.nodeSet.id && ('exact' in chain.via.ref.match ? chain.via.ref.match.exact : chain.via.ref.match.regex) ? targetLabel(chain.via, groupName, nodeSetName) : '待选前置') : chain.via.name;
  const landingText = landingLabel ?? landingNodeName(chain.landing) ?? (chain.landing.nodeSet.id ? `${nodeSetName(chain.landing.nodeSet)}${!fixedLanding && !legacyLanding && landingKind === 'inline' ? ' · 待选节点' : whole ? ' · 全部节点' : ' · 原筛选范围'}` : '待选落地');
  const actions = <><span className="mr-auto w-full self-center text-[12px] text-ink-muted sm:w-auto">保存订阅后生效</span>{onRemove && <Button className="text-err" onClick={onRemove}>移除前置</Button>}<Button onClick={onCancel}>取消{footerTarget ? '前置' : ''}</Button><Button variant="primary" disabled={!!error || overridden} onClick={() => onApply(chain)}>{footerTarget ? '应用前置' : '应用代理链'}</Button></>;
  return <section aria-label="代理链设置" className={footerTarget ? 'flex min-w-0 flex-col' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
    <div className={footerTarget ? 'flex flex-col gap-5' : 'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4'}>
      <div aria-label="流量路径" className="rounded-md bg-ground px-3 py-2 text-[12px] leading-relaxed break-words">本机 → <strong>{viaLabel}</strong> → <strong>{landingText}</strong> → 目标</div>
      <div className="grid gap-5 sm:grid-cols-2">
      <section aria-label="前置节点" className="flex min-w-0 flex-col gap-3">
        <div><h3 className="m-0 text-[14px] font-semibold">1. 前置节点</h3><p className="mt-1 mb-0 text-[12px] text-ink-muted">本机先连接这里，再经由它连接落地。</p></div>
        <Segmented label="前置来源" value={kind} options={[{ value: 'provider', label: 'Provider', disabled: !sourcesFor('provider').length }, { value: 'inline', label: 'Inline', disabled: !sourcesFor('inline').length }, { value: 'group', label: '策略组', disabled: !groupOptions.length }, ...(initial.via.kind === 'builtin' ? [{ value: 'direct' as const, label: `${initial.via.name}（原设置）` }] : [])]} onChange={v => { setKind(v); choose(v === 'group' ? { kind: 'group', groupId: '' } : v === 'direct' ? initial.via : emptyVia(v)); }} />
        {(kind === 'inline' || kind === 'provider') && <>
          <Field label={kind === 'provider' ? '前置 Provider' : '前置 Inline 节点集'}>{id => <Select id={id} placeholder={`选择提供前置节点的 ${kind === 'provider' ? 'Provider' : 'Inline 节点集'}`} disabled={!sources.length} value={active ? nodeSetKey(active.ref) : ''} onChange={e => { const s = sources.find(s => nodeSetKey(s.ref) === e.target.value); if (s) choose(emptyVia(kind, s.ref)); }}>{sources.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}</Field>
          {kind === 'provider' && chain.via.kind === 'node' && <>
            <Field label="前置节点筛选（正则）">{id => <Input id={id} placeholder={chainPlaceholders.viaFilter} disabled={!active} value={viaFilter} onChange={e => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match: { regex: e.target.value } } }); }} />}</Field>
            <ProviderMatch via={chain.via} />
          </>}
          {kind === 'inline' && chain.via.kind === 'node' && 'regex' in chain.via.ref.match && chain.via.ref.match.regex && <p className="m-0 text-[12px] text-ink-muted">原前置筛选：{chain.via.ref.match.regex}。保留此设置，或点选下方节点替换。</p>}
          {kind === 'inline' && <InlineNodes key={`via:${active ? nodeSetKey(active.ref) : ''}`} nodeSet={active?.ref} selected={chain.via.kind === 'node' && 'exact' in chain.via.ref.match ? chain.via.ref.match.exact : undefined} label="前置节点" onSelect={name => { if (active) choose({ kind: 'node', ref: { nodeSet: active.ref, match: { exact: name }, fallback: 'error' } }); }} />}
        </>}
        {kind === 'group' && <Field label="前置策略组">{id => <Select id={id} placeholder="选择用于连接落地节点的前置策略组" value={chain.via.kind === 'group' ? chain.via.groupId : ''} onChange={e => choose({ kind: 'group', groupId: e.target.value })}>{groupOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}</Field>}
      </section>
      <section aria-label="落地节点" className="flex min-w-0 flex-col gap-3 border-t border-line pt-5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
        <div><h3 className="m-0 text-[14px] font-semibold">2. 落地节点</h3><p className="mt-1 mb-0 text-[12px] text-ink-muted">通过前置连接这里，由落地访问目标。</p></div>
        {fixedLanding ? <div className="rounded-md bg-ground p-3 text-[13px]">{landingText}</div> : legacyLanding ? <div className="rounded-md bg-ground p-3 text-[13px]">
          <strong>{nodeSetName(chain.landing.nodeSet)}</strong><p className="my-2 break-all">原范围：{chain.landing.filter || '全部节点'}{chain.landing.excludeFilter && `；排除 ${chain.landing.excludeFilter}`}</p><p className="my-2 text-[12px] text-ink-muted">保留已有范围。重新选择后，Inline 指定单个节点，Provider 作用于整集。</p><Button size="sm" onClick={() => { setLegacyLanding(false); setChain({ ...chain, landing: { nodeSet: emptySet } }); }}>重新选择落地</Button>
        </div> : <>
          <Segmented label="落地来源" value={landingKind} options={[{ value: 'inline', label: 'Inline · 单个节点', disabled: !sourcesFor('inline').length }, { value: 'provider', label: 'Provider · 整个节点集', disabled: !sourcesFor('provider').length }]} onChange={v => { setLandingKind(v); setChain({ ...chain, landing: { nodeSet: emptySet } }); }} />
          <Field label={landingKind === 'provider' ? '落地 Provider' : '落地 Inline 节点集'}>{id => <Select id={id} placeholder={landingKind === 'provider' ? '选择整体经由前置连接的 Provider' : '选择提供落地节点的 Inline 节点集'} value={landingSource ? nodeSetKey(landingSource.ref) : ''} disabled={!sourcesFor(landingKind).length} onChange={e => { const s = sourcesFor(landingKind).find(s => nodeSetKey(s.ref) === e.target.value); if (s) setChain({ ...chain, landing: { nodeSet: s.ref } }); }}>{sourcesFor(landingKind).map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}</Field>
          {landingKind === 'inline' ? <InlineNodes key={`landing:${nodeSetKey(chain.landing.nodeSet)}`} nodeSet={landingSource?.ref} selected={landingNodeName(chain.landing)} label="落地节点" onSelect={name => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, filter: exactNodeFilter(name) } })} /> : <p className="m-0 text-[12px] text-ink-muted">整集前置：此 Provider 的全部节点（含后续新增节点）统一经由上述前置连接。</p>}
        </>}
      </section>
      </div>
      <p className="m-0 text-[12px] text-ink-muted">仅作用于本订阅；同一落地节点在各策略组中使用相同前置。</p>
      {overridden && <p role="alert" className="m-0 text-[12px] text-warn">已有整集前置覆盖此设置，请先在「代理链」中调整或移除整集规则。</p>}
      {error && <p role="status" className={`m-0 text-[12px] ${error.startsWith('请选择') ? 'text-ink-muted' : 'text-err'}`}>{error}</p>}
    </div>
    {footerTarget ? createPortal(actions, footerTarget) : <div data-slot="dialog-footer" className="flex h-[105px] shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-ground px-5 py-3 sm:h-[65px]">{actions}</div>}
  </section>;
}

export function chainForLanding(chains: ChainRule[], landing: ChainRule['landing']): ChainRule {
  return chains.find(c => sameLanding(c.landing, landing)) ?? { id: `chain_${crypto.randomUUID()}`, landing, via: emptyVia('provider') };
}
