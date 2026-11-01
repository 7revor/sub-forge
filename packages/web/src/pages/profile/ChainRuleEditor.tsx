import { useModalDraft } from '../../modals/index.tsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { chainSources, type ChainRule, type ChainNodeSet, type ChainTarget } from '@sub-forge/core';
import { NodeSetPreview } from '../../components/NodeSetPreview.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { useChainNames } from './useChainNames.ts';
import { Button, Field, Input, Select } from '../../components/ui.tsx';
import { chainPlaceholders } from '../../schemas/placeholders.ts';
import { useProfile } from './context.ts';
import { chainInputError, exactNodeFilter, selectedNodeFilter, nodeSetKey, sameLanding } from './memberModel.ts';
import { SelectIndicator } from '../../components/SelectIndicator.tsx';

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
  const previewSources = (scope: ChainNodeSet) => chainSources(scope, draft.nodeSets).map(source => ({ ref: source.ref, name: nodeSetName(source.ref) }));
  const whole = !chain.landing.filter && !chain.landing.excludeFilter;
  const overridden = !whole && draft.chains.some(c => c.id !== chain.id && chainSources(c.landing.nodeSet, draft.nodeSets).some(source => chainSources(chain.landing.nodeSet, draft.nodeSets).some(current => nodeSetKey(source.ref) === nodeSetKey(current.ref))) && !c.landing.filter && !c.landing.excludeFilter);
  const error = (chain.landing.filter === 'a^' ? '请至少选择一个落地节点' : undefined) ?? ((kind === 'provider' || kind === 'inline') && !sources.length ? '当前前置类型没有节点来源' : !previewSources(chain.landing.nodeSet).length ? '当前落地范围没有节点来源' : undefined) ?? chainInputError(chain) ?? (draft.chains.some(c => c.id !== chain.id && sameLanding(c.landing, chain.landing)) ? '该落地范围已有代理链，请编辑已有规则' : undefined);
  const viaAuto = chain.via.kind === 'node' && 'regex' in chain.via.ref.match && !chain.via.ref.match.regex;
  const viaFilter = chain.via.kind === 'node' ? ('regex' in chain.via.ref.match ? chain.via.ref.match.regex : chain.via.ref.match.exact ? exactNodeFilter(chain.via.ref.match.exact) : '') : '';
  const choose = (via: ChainTarget) => setChain({ ...chain, via });
  const names = useChainNames(chain);
  const landingText = names.landing;
  const actions = <>{onRemove && <Button className="text-destructive" onClick={onRemove}>移除前置</Button>}<Button onClick={onCancel}>取消{footerTarget ? '前置' : ''}</Button><Button variant="primary" disabled={!!error || overridden} onClick={() => onApply(chain)}>{footerTarget ? '应用前置' : '保存'}</Button></>;
  const sourceChoices = <>{(['provider','inline'] as const).map(output => <optgroup key={output} label={output === 'provider' ? '引用来源' : '展开节点'}><option value={`all:${output}`}>{output === 'provider' ? '全部引用来源' : '全部展开节点'}</option>{sourcesFor(output).map(source => <option key={nodeSetKey(source.ref)} value={nodeSetKey(source.ref)}>{source.name} · {output === 'provider' ? '引用' : '展开'}</option>)}</optgroup>)}</>;
  const pickSource = (key: string): ChainNodeSet => key.startsWith('all:') ? allSources(key.slice(4) as SourceKind) : profileNodeSets.find(source => nodeSetKey(source.ref) === key)?.ref ?? emptySet;
  return <section aria-label="代理链设置" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-4 sm:grid-cols-2">
      <section aria-label="前置节点" className="flex min-h-0 min-w-0 flex-col gap-3 rounded-[10px] border border-border p-4">
        <div className="flex items-baseline gap-2"><h3 className="m-0 text-sm font-medium">① 前置</h3><p className="m-0 text-xs text-muted-foreground">先连接这里</p></div>
        <Field label="来源">{id => <Select id={id} aria-label="前置来源" placeholder="选择节点来源或策略组" value={kind === 'group' ? 'group' : kind === 'direct' ? 'direct' : chain.via.kind === 'node' ? nodeSetKey(chain.via.ref.nodeSet) : ''} onChange={event => {
          if (event.target.value === 'group') { setKind('group'); choose({ kind: 'group', groupId: '' }); }
          else if (event.target.value === 'direct') { setKind('direct'); choose(initial.via); }
          else { const source = pickSource(event.target.value), output = outputOf(source) ?? 'inline'; setKind(output); choose(emptyVia(source)); }
        }}>{sourceChoices}<optgroup label="策略组"><option value="group" disabled={!groupOptions.length}>策略组</option></optgroup>{initial.via.kind === 'builtin' && <option value="direct">{initial.via.name}</option>}</Select>}</Field>
        {chain.via.kind === 'node' && (kind === 'provider' ? <div className="chain-node-panel">
          <div className="border-b border-border p-2"><SearchInput className="max-w-none" aria-label="前置节点筛选（正则）" placeholder={chainPlaceholders.viaFilter} value={viaFilter} onChange={event => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match: { regex: event.target.value } } }); }} /></div>
          <NodeSetPreview nodeSets={previewSources(chain.via.ref.nodeSet)} filter={viaFilter} label="前置节点" firstMatch />
        </div> : <div className="chain-node-panel">
          <ChoiceRow radio checked={viaAuto} label="自动（按顺序取第一个可用）" onClick={() => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match: { regex: '' } } }); }} />
          <NodeSetPreview nodeSets={previewSources(chain.via.ref.nodeSet)} selection={viaAuto ? undefined : { match: chain.via.ref.match }} label="前置节点" firstMatch={viaAuto} onSelect={(name,nodeSet) => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, nodeSet, match: { exact: name } } }); }} />
        </div>)}
        {kind === 'group' && <div role="group" aria-label="前置策略组" className="chain-node-panel">
          {groupOptions.map(group => <ChoiceRow key={group.id} radio checked={chain.via.kind === 'group' && chain.via.groupId === group.id} label={group.name} onClick={() => choose({ kind: 'group', groupId: group.id })} />)}
        </div>}
      </section>
      <section aria-label="落地节点" className="flex min-h-0 min-w-0 flex-col gap-3 rounded-[10px] border border-primary/30 bg-muted/50 p-4">
        <div className="flex items-baseline gap-2"><h3 className="m-0 text-sm font-medium">② 落地</h3><p className="m-0 text-xs text-muted-foreground">由它访问目标</p></div>
        {fixedLanding ? <div className="rounded-md bg-muted p-3 text-sm">{landingText}</div> : <>
          <Field label="来源">{id => <Select id={id} aria-label="落地来源" placeholder="选择落地节点来源" value={nodeSetKey(chain.landing.nodeSet)} onChange={event => { const source = pickSource(event.target.value); setLandingKind(outputOf(source) ?? 'inline'); setChain({ ...chain, landing: { nodeSet: source } }); }}>{sourceChoices}</Select>}</Field>{landingKind === 'provider' ? <div className="chain-node-panel">
          <div className="flex flex-col gap-2 border-b border-border p-2"><SearchInput className="max-w-none" aria-label="落地节点筛选（正则）" placeholder={chainPlaceholders.landingFilter} value={chain.landing.filter ?? ''} onChange={event => setChain({ ...chain, landing: { ...chain.landing, filter: event.target.value || undefined } })} />
            {chain.landing.excludeFilter !== undefined && <Input aria-label="排除落地节点（正则）" placeholder="输入要排除的节点名称或正则" value={chain.landing.excludeFilter} onChange={event => setChain({ ...chain, landing: { ...chain.landing, excludeFilter: event.target.value } })} />}</div>
          <NodeSetPreview nodeSets={previewSources(chain.landing.nodeSet)} filter={chain.landing.filter} excludeFilter={chain.landing.excludeFilter} label="落地节点" />
        </div> : <div className="chain-node-panel">
          <ChoiceRow checked={whole} label="全部节点" onClick={() => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, ...(whole ? { filter: selectedNodeFilter([]) } : {}) } })} />
          <NodeSetPreview nodeSets={previewSources(chain.landing.nodeSet)} selection={{ filter: chain.landing.filter, excludeFilter: chain.landing.excludeFilter }} multiple label="落地节点" onSelect={(_name,_nodeSet,selectedNames) => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, filter: selectedNodeFilter(selectedNames) } })} />
        </div>}
        </>}
      </section>
    </div>
    {(overridden || error) && <p role="alert" className="mx-6 mt-0 mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{overridden ? '已有整集前置覆盖此设置，请先调整已有规则。' : error}</p>}
    {footerTarget ? createPortal(actions, footerTarget) : <div data-slot="dialog-footer" className="flex min-h-[61px] shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">{actions}</div>}
  </section>;
}

/** 节点面板顶部的固定选项行（自动 / 全部节点 / 策略组），与节点行同高同样式。 */
function ChoiceRow({ checked, label, radio = false, onClick }: { checked: boolean; label: string; radio?: boolean; onClick: () => void }) {
  return <button type="button" role={radio ? 'radio' : 'checkbox'} aria-checked={checked} onClick={onClick}
    className={`flex min-h-10 w-full shrink-0 cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm ${checked ? 'bg-primary/5' : 'hover:bg-muted'}`}>
    <SelectIndicator checked={checked} multiple={!radio} />
    <span className="min-w-0 truncate">{label}</span>
  </button>;
}

export function chainForLanding(chains: ChainRule[], landing: ChainRule['landing']): ChainRule {
  return chains.find(c => sameLanding(c.landing, landing)) ?? { id: `chain_${crypto.randomUUID()}`, landing, via: emptyVia() };
}
