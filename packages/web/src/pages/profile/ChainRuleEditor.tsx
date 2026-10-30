import { useState } from 'react';
import type { ChainRule, Target } from '@sub-forge/core';
import { useNodeList } from '../../hooks.ts';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { NodeSetSelect, targetLabel } from '../../components/pickers.tsx';
import { Button, Empty, ErrorAlert, Field, Input, Segmented, Select } from '../../components/ui.tsx';
import { useProfile } from './context.ts';
import { chainInputError, nodeSetKey, sameLanding } from './memberModel.ts';

/** 三个入口共享同一份订阅链规则，编辑期间不修改节点源。 */
export function ChainRuleEditor({ initial, fixedLanding = false, onApply, onCancel, onRemove }: {
  initial: ChainRule; fixedLanding?: boolean; onApply: (chain: ChainRule) => void; onCancel: () => void; onRemove?: () => void;
}) {
  const { draft, profileNodeSets, groupOptions, groupName, nodeSetName } = useProfile();
  const [chain, setChain] = useState(initial);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'inline' | 'provider' | 'group' | 'direct'>(() => initial.via.kind === 'group' ? 'group' : initial.via.kind === 'builtin' ? 'direct' : draft.nodeSets.find(s => nodeSetKey(s.ref) === nodeSetKey(initial.via.kind === 'node' ? initial.via.ref.nodeSet : initial.landing.nodeSet))?.output ?? 'inline');
  const [source, setSource] = useState(initial.via.kind === 'node' ? nodeSetKey(initial.via.ref.nodeSet) : '');
  const sources = profileNodeSets.filter(s => draft.nodeSets.some(n => nodeSetKey(n.ref) === nodeSetKey(s.ref) && n.output === kind));
  const active = sources.find(s => nodeSetKey(s.ref) === source) ?? sources[0];
  const nodes = useNodeList(kind === 'inline' || kind === 'provider' ? active?.ref : undefined, useDebouncedValue(search, 200));
  const whole = !chain.landing.filter && !chain.landing.excludeFilter;
  const overridden = !whole && draft.chains.some(c => c.id !== chain.id && nodeSetKey(c.landing.nodeSet) === nodeSetKey(chain.landing.nodeSet) && !c.landing.filter && !c.landing.excludeFilter);
  const error = chainInputError(chain) ?? (draft.chains.some(c => c.id !== chain.id && sameLanding(c.landing, chain.landing)) ? '该落地范围已有前置规则，请编辑已有规则' : undefined);
  const choose = (via: Target) => setChain({ ...chain, via });
  return <section aria-label="前置设置" className="flex min-w-0 flex-col gap-4">
    {fixedLanding ? <div className="text-[13px]"><strong>{nodeSetName(chain.landing.nodeSet)}</strong><span className="ml-2 text-ink-muted">{whole ? '全部节点' : '指定节点'}</span></div> : <>
      <Field label="落地节点集">{() => <NodeSetSelect label="落地节点集" value={chain.landing.nodeSet} options={profileNodeSets} onChange={nodeSet => setChain({ ...chain, landing: { ...chain.landing, nodeSet } })} />}</Field>
      <Segmented label="落地范围" value={whole ? 'whole' : 'filter'} options={[{ value: 'whole', label: '整集统一' }, { value: 'filter', label: '按节点筛选' }]} onChange={mode => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, ...(mode === 'filter' ? { filter: '.*' } : {}) } })} />
      {!whole && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="保留节点（正则）">{id => <Input placeholder="仅保留名称匹配此正则表达式的落地节点" id={id} value={chain.landing.filter ?? ''} onChange={e => setChain({ ...chain, landing: { ...chain.landing, filter: e.target.value || undefined } })} />}</Field>
        <Field label="排除节点（正则）">{id => <Input placeholder="排除名称匹配此正则表达式的落地节点" id={id} value={chain.landing.excludeFilter ?? ''} onChange={e => setChain({ ...chain, landing: { ...chain.landing, excludeFilter: e.target.value || undefined } })} />}</Field>
      </div>}
      <MatchPreview nodeSet={chain.landing.nodeSet} filter={chain.landing.filter} excludeFilter={chain.landing.excludeFilter} max={6} />
    </>}
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <span className="text-[13px] font-semibold">通过哪个前置连接</span>
      <Segmented label="前置来源" value={kind} options={[{ value: 'inline', label: 'Inline 节点' }, { value: 'provider', label: 'Provider 节点' }, { value: 'group', label: '策略组' }, { value: 'direct', label: '直连' }]} onChange={v => { setKind(v); setSearch(''); if (v === 'direct') choose({ kind: 'builtin', name: 'DIRECT' }); else if (v === 'group') choose({ kind: 'group', groupId: '' }); else choose({ kind: 'node', ref: { nodeSet: { type: 'source', id: '' }, match: { exact: '' }, fallback: 'error' } }); }} />
      {(kind === 'inline' || kind === 'provider') && <>
        <div className="grid gap-2 sm:grid-cols-2"><Select placeholder="选择提供前置节点的节点集" aria-label="前置节点集" value={active ? nodeSetKey(active.ref) : ''} onChange={e => { setSource(e.target.value); setSearch(''); choose({ kind: 'node', ref: { nodeSet: { type: 'source', id: '' }, match: { exact: '' }, fallback: 'error' } }); }}>{sources.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select><Input aria-label="搜索前置节点" placeholder="搜索后点选一个节点" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {!active ? <Empty title={`先在订阅中加入 ${kind === 'inline' ? 'Inline' : 'Provider'} 节点集`} /> : <div className="max-h-48 overflow-y-auto rounded-md border border-line">
          <ErrorAlert error={nodes.error} />
          {nodes.isLoading && <p className="px-3 text-[13px] text-ink-muted">正在加载节点…</p>}
          {nodes.data?.nodes.map(n => <button type="button" key={n.name} aria-pressed={chain.via.kind === 'node' && nodeSetKey(chain.via.ref.nodeSet) === nodeSetKey(active.ref) && 'exact' in chain.via.ref.match && chain.via.ref.match.exact === n.name} onClick={() => choose({ kind: 'node', ref: { nodeSet: active.ref, match: { exact: n.name }, fallback: 'error' } })} className="flex w-full cursor-pointer items-center justify-between border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-ground aria-pressed:bg-accent-soft aria-pressed:text-brand"><span>{n.name}</span><span className="text-[11px] text-ink-muted">{n.type.toUpperCase()}</span></button>)}
          {nodes.data && !nodes.data.nodes.length && <Empty title="没有匹配节点" />}
          {nodes.data?.truncated && <p className="px-3 text-[12px] text-ink-muted">结果较多，请搜索缩小范围。</p>}
        </div>}
        {kind === 'provider' && <p className="m-0 text-[12px] text-ink-muted">自动建立精确引用；前置不可用时拒绝连接。</p>}
      </>}
      {kind === 'group' && <Select placeholder="选择用于连接落地节点的前置策略组" aria-label="前置策略组" value={chain.via.kind === 'group' ? chain.via.groupId : ''} onChange={e => choose({ kind: 'group', groupId: e.target.value })}>{groupOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}
    </div>
    <div className="rounded-md bg-ground px-3 py-2 text-[13px]">本机 → <strong>{chainInputError({ ...chain, landing: initial.landing }) ? '请选择前置' : targetLabel(chain.via, groupName, nodeSetName)}</strong> → {nodeSetName(chain.landing.nodeSet)} → 目标</div>
    <p className="m-0 text-[12px] text-ink-muted">仅作用于本订阅。同一节点在其他策略组中的引用也使用此连接方式。</p>
    {overridden && <p role="alert" className="m-0 text-[12px] text-warn">已有整集前置会覆盖此设置。请先在「代理链」中将整集规则改为按节点配置。</p>}
    {error && <p role="status" className="m-0 text-[12px] text-err">{error}</p>}
    <div className="flex justify-end gap-2 border-t border-line pt-3">{onRemove && <Button className="mr-auto text-err" onClick={onRemove}>移除此设置</Button>}<Button onClick={onCancel}>取消</Button><Button variant="primary" disabled={!!error || overridden} onClick={() => onApply(chain)}>应用前置</Button></div>
  </section>;
}

export function chainForLanding(chains: ChainRule[], landing: ChainRule['landing']): ChainRule {
  return chains.find(c => sameLanding(c.landing, landing)) ?? { id: `chain_${crypto.randomUUID()}`, landing, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: '' }, match: { exact: '' }, fallback: 'error' } } };
}
