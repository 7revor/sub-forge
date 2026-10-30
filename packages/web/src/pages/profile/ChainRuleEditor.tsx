import { useModalDraft } from '../../modals/index.tsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { chainSources, type ChainRule, type ChainNodeSet, type ChainTarget } from '@sub-forge/core';
import { NodeSetPreview } from '../../components/NodeSetPreview.tsx';
import { useChainNames } from './useChainNames.ts';
import { Button, Field, Input, Segmented, Select } from '../../components/ui.tsx';
import { chainPlaceholders } from '../../schemas/placeholders.ts';
import { useProfile } from './context.ts';
import { chainInputError, exactNodeFilter, nodeSetKey, sameLanding } from './memberModel.ts';

type SourceKind = 'inline' | 'provider';
const emptySet: ChainNodeSet = { type: 'source', id: '' };
const allSources = (output: SourceKind): ChainNodeSet => ({ type: 'all', id: output });
const emptyVia = (nodeSet: ChainNodeSet = emptySet): ChainTarget => ({ kind: 'node', ref: { nodeSet, match: { regex: '' }, fallback: 'error' } });

/** 编辑顺序与流量方向一致；前置与落地各自选择，整集设置只由代理链入口创建。 */
export function ChainRuleEditor({ initial, fixedLanding = false, onApply, onCancel, onRemove, footerTarget }: {
  initial: ChainRule; fixedLanding?: boolean; onApply: (chain: ChainRule) => void; onCancel: () => void; onRemove?: () => void; footerTarget?: HTMLDivElement | null;
}) {
  const { draft, profileNodeSets, groupOptions, nodeSetName } = useProfile();
  const outputOf = (ref: ChainNodeSet) => ref.type === 'all' ? ref.id : draft.nodeSets.find(s => nodeSetKey(s.ref) === nodeSetKey(ref))?.output;
  const defaultKind = draft.nodeSets.some(source => source.output === 'provider') ? 'provider' : 'inline';
  const [chain, setChain] = useModalDraft(() => ({ ...initial, landing: { ...initial.landing, nodeSet: initial.landing.nodeSet.id ? initial.landing.nodeSet : allSources(defaultKind) }, via: initial.via.kind === 'node' && !initial.via.ref.nodeSet.id ? { ...initial.via, ref: { ...initial.via.ref, nodeSet: allSources(defaultKind) } } : initial.via }));
  const [kind, setKind] = useState<SourceKind | 'group' | 'direct'>(() => initial.via.kind === 'group' ? 'group' : initial.via.kind === 'builtin' ? 'direct' : outputOf(initial.via.ref.nodeSet) ?? (draft.nodeSets.some(s => s.output === 'provider') ? 'provider' : 'inline'));
  const [landingKind, setLandingKind] = useState<SourceKind>(outputOf(initial.landing.nodeSet) ?? (draft.nodeSets.some(s => s.output === 'provider') ? 'provider' : 'inline'));
  const sourcesFor = (output: SourceKind) => profileNodeSets.filter(s => outputOf(s.ref) === output);
  const sources = kind === 'provider' || kind === 'inline' ? sourcesFor(kind) : [];
  const active = chain.via.kind === 'node' ? sources.find(s => nodeSetKey(s.ref) === nodeSetKey(chain.via.kind === 'node' ? chain.via.ref.nodeSet : emptySet)) : undefined;
  const previewSources = (scope: ChainNodeSet) => chainSources(scope, draft.nodeSets).map(source => ({ ref: source.ref, name: nodeSetName(source.ref) }));
  const landingSource = sourcesFor(landingKind).find(s => nodeSetKey(s.ref) === nodeSetKey(chain.landing.nodeSet));
  const whole = !chain.landing.filter && !chain.landing.excludeFilter;
  const overridden = !whole && draft.chains.some(c => c.id !== chain.id && chainSources(c.landing.nodeSet, draft.nodeSets).some(source => chainSources(chain.landing.nodeSet, draft.nodeSets).some(current => nodeSetKey(source.ref) === nodeSetKey(current.ref))) && !c.landing.filter && !c.landing.excludeFilter);
  const error = ((kind === 'provider' || kind === 'inline') && !sources.length ? '当前前置类型没有节点来源' : !previewSources(chain.landing.nodeSet).length ? '当前落地范围没有节点来源' : undefined) ?? chainInputError(chain) ?? (draft.chains.some(c => c.id !== chain.id && sameLanding(c.landing, chain.landing)) ? '该落地范围已有代理链，请编辑已有规则' : undefined);
  const viaFilter = chain.via.kind === 'node' ? ('regex' in chain.via.ref.match ? chain.via.ref.match.regex : chain.via.ref.match.exact ? exactNodeFilter(chain.via.ref.match.exact) : '') : '';
  const choose = (via: ChainTarget) => setChain({ ...chain, via });
  const names = useChainNames(chain);
  const viaLabel = names.via;
  const landingText = names.landing;
  const actions = <>{onRemove && <Button className="text-err" onClick={onRemove}>移除前置</Button>}<Button onClick={onCancel}>取消{footerTarget ? '前置' : ''}</Button><Button variant="primary" disabled={!!error || overridden} onClick={() => onApply(chain)}>{footerTarget ? '应用前置' : '应用代理链'}</Button></>;
  return <section aria-label="代理链设置" className={footerTarget ? 'flex min-w-0 flex-col' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
    <div className={footerTarget ? 'flex flex-col gap-5' : 'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4'}>
      <div aria-label="流量路径" className="rounded-md bg-ground px-3 py-2 text-[12px] leading-relaxed break-words">本机 → <strong>{viaLabel}</strong> → <strong>{landingText}</strong> → 目标</div>
      <div className="grid gap-5 sm:grid-cols-2">
      <section aria-label="前置节点" className="flex min-w-0 flex-col gap-3">
        <div><h3 className="m-0 text-[14px] font-semibold">1. 前置节点</h3><p className="mt-1 mb-0 text-[12px] text-ink-muted">本机先连接这里，再经由它连接落地。</p></div>
        <Segmented label="前置来源" value={kind} options={[{ value: 'provider', label: 'Provider', disabled: !sourcesFor('provider').length }, { value: 'inline', label: 'Inline', disabled: !sourcesFor('inline').length }, { value: 'group', label: '策略组', disabled: !groupOptions.length }, ...(initial.via.kind === 'builtin' ? [{ value: 'direct' as const, label: `${initial.via.name}（原设置）` }] : [])]} onChange={v => { setKind(v); choose(v === 'group' ? { kind: 'group', groupId: '' } : v === 'direct' ? initial.via : emptyVia(allSources(v))); }} />
        {(kind === 'inline' || kind === 'provider') && <>
          <Field label={kind === 'provider' ? '前置 Provider' : '前置 Inline 节点集'}>{id => <Select id={id} aria-label={kind === 'provider' ? '前置 Provider' : '前置 Inline 节点集'} placeholder="全部" clearable disabled={!sources.length} value={active ? nodeSetKey(active.ref) : ''} onChange={e => { const s = sources.find(s => nodeSetKey(s.ref) === e.target.value); if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, nodeSet: s?.ref ?? allSources(kind), ...(kind === 'inline' ? { match: { regex: '' } } : {}) } }); }}>{sources.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}</Field>
          {chain.via.kind === 'node' && <>
            {kind === 'provider' ? <>
              <Field label="前置节点筛选（正则）">{id => <Input id={id} placeholder={chainPlaceholders.viaFilter} disabled={!sources.length} value={viaFilter} onChange={e => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match: { regex: e.target.value } } }); }} />}</Field>
              <p className="m-0 text-[12px] text-ink-muted">来源留空包含全部同类来源；可筛选或点击节点。</p>
            </> : <div className="flex items-center justify-between gap-2 text-[12px] text-ink-muted">
              <p className="m-0">点击节点指定前置；未指定时按顺序采用首个节点。</p>
              {viaFilter && <Button size="sm" variant="ghost" onClick={() => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match: { regex: '' } } }); }}>恢复全部前置节点</Button>}
            </div>}
            <NodeSetPreview nodeSets={previewSources(chain.via.ref.nodeSet)} filter={kind === 'provider' ? viaFilter : undefined} selection={kind === 'inline' ? { match: chain.via.ref.match } : undefined} label="前置节点" firstMatch onSelect={(name, nodeSet) => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, nodeSet, match: { exact: name } } }); }} />
          </>}
        </>}
        {kind === 'group' && <div className="flex flex-col gap-2">
          <p className="m-0 text-[12px] text-ink-muted">点击策略组作为前置。</p>
          <div role="group" aria-label="前置策略组" className="max-h-64 overflow-y-auto rounded-md border border-line">
            {groupOptions.map(group => {
              const selected = chain.via.kind === 'group' && chain.via.groupId === group.id;
              return <button key={group.id} type="button" aria-pressed={selected} className={`flex w-full cursor-pointer items-center justify-between gap-3 border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-ground focus-visible:bg-ground ${selected ? 'bg-ground font-medium' : ''}`} onClick={() => choose({ kind: 'group', groupId: group.id })}><span className="min-w-0 break-all">{group.name}</span>{selected && <span className="shrink-0 text-[11px] text-ink-muted">当前采用</span>}</button>;
            })}
          </div>
        </div>}
      </section>
      <section aria-label="落地节点" className="flex min-w-0 flex-col gap-3 border-t border-line pt-5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
        <div><h3 className="m-0 text-[14px] font-semibold">2. 落地节点</h3><p className="mt-1 mb-0 text-[12px] text-ink-muted">通过前置连接这里，由落地访问目标。</p></div>
        {fixedLanding ? <div className="rounded-md bg-ground p-3 text-[13px]">{landingText}</div> : <>
          <Segmented label="落地来源" value={landingKind} options={[{ value: 'inline', label: 'Inline', disabled: !sourcesFor('inline').length }, { value: 'provider', label: 'Provider', disabled: !sourcesFor('provider').length }]} onChange={v => { setLandingKind(v); setChain({ ...chain, landing: { nodeSet: allSources(v) } }); }} />
          <Field label={landingKind === 'provider' ? '落地 Provider' : '落地 Inline 节点集'}>{id => <Select id={id} aria-label={landingKind === 'provider' ? '落地 Provider' : '落地 Inline 节点集'} placeholder="全部" clearable value={landingSource ? nodeSetKey(landingSource.ref) : ''} disabled={!sourcesFor(landingKind).length} onChange={e => { const s = sourcesFor(landingKind).find(s => nodeSetKey(s.ref) === e.target.value); setChain({ ...chain, landing: { ...(landingKind === 'provider' ? chain.landing : {}), nodeSet: s?.ref ?? allSources(landingKind) } }); }}>{sourcesFor(landingKind).map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}</Field>
          {landingKind === 'provider' ? <>
            <Field label="落地节点筛选（正则）">{id => <Input id={id} placeholder="全部" disabled={!sourcesFor(landingKind).length} value={chain.landing.filter ?? ''} onChange={e => setChain({ ...chain, landing: { ...chain.landing, filter: e.target.value || undefined } })} />}</Field>
            {chain.landing.excludeFilter !== undefined && <Field label="排除落地节点（正则）">{id => <Input id={id} placeholder="输入要排除的节点名称或正则" value={chain.landing.excludeFilter} onChange={e => setChain({ ...chain, landing: { ...chain.landing, excludeFilter: e.target.value } })} />}</Field>}
            <p className="m-0 text-[12px] text-ink-muted">来源留空包含全部同类来源及后续新增节点；可筛选或点击节点。</p>
          </> : <div className="flex items-center justify-between gap-2 text-[12px] text-ink-muted">
            <p className="m-0">默认使用全部节点；点击节点指定落地。</p>
            {!whole && <Button size="sm" variant="ghost" onClick={() => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet } })}>恢复全部落地节点</Button>}
          </div>}
          <NodeSetPreview nodeSets={previewSources(chain.landing.nodeSet)} filter={landingKind === 'provider' ? chain.landing.filter : undefined} excludeFilter={landingKind === 'provider' ? chain.landing.excludeFilter : undefined} selection={landingKind === 'inline' ? { filter: chain.landing.filter, excludeFilter: chain.landing.excludeFilter } : undefined} label="落地节点" onSelect={(name, nodeSet) => setChain({ ...chain, landing: { nodeSet, filter: exactNodeFilter(name), ...(landingKind === 'provider' && chain.landing.excludeFilter !== undefined ? { excludeFilter: chain.landing.excludeFilter } : {}) } })} />
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
  return chains.find(c => sameLanding(c.landing, landing)) ?? { id: `chain_${crypto.randomUUID()}`, landing, via: emptyVia() };
}
