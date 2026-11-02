import { useModalDraft } from '../../modals/index.tsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { chainSources, type ChainRule, type ChainNodeSet, type ChainTarget, type NodeRef } from '@sub-forge/core';
import { NodeSetPreview } from '../../components/NodeSetPreview.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { useChainNames } from './useChainNames.ts';
import { Button, Field, Select } from '../../components/ui.tsx';
import { chainPlaceholders } from '../../schemas/placeholders.ts';
import { useProfile } from './context.ts';
import { landingConstraintHint, viaConstraintHint } from './chainModel.ts';
import { chainInputError, NO_NODE_FILTER, selectedNodeFilter, nodeSetKey, sameLanding } from './memberModel.ts';
import { SelectIndicator } from '../../components/SelectIndicator.tsx';

type SourceKind = 'inline' | 'provider';
const emptySet: ChainNodeSet = { type: 'source', id: '' };
const allSources = (output: SourceKind): ChainNodeSet => ({ type: 'all', id: output });
const emptyVia = (nodeSet: ChainNodeSet = emptySet): ChainTarget => ({ kind: 'node', ref: { nodeSet, match: { regex: '' }, fallback: 'error' } });

/** 编辑顺序与流量方向一致；来源与节点列表相互独立，点选节点不改变来源范围，实际约束以弱提示说明。 */
export function ChainRuleEditor({ initial, fixedLanding = false, onApply, onCancel, onRemove, footerTarget }: {
  initial: ChainRule; fixedLanding?: boolean; onApply: (chain: ChainRule) => void; onCancel: () => void; onRemove?: () => void; footerTarget?: HTMLDivElement | null;
}) {
  const { draft, profileNodeSets, groupOptions, nodeSetName } = useProfile();
  const outputOf = (ref: ChainNodeSet) => ref.type === 'all' ? ref.id : draft.nodeSets.find(s => nodeSetKey(s.ref) === nodeSetKey(ref))?.output;
  const defaultKind = draft.nodeSets.some(source => source.output === 'provider') ? 'provider' : 'inline';
  const [chain, setChain] = useModalDraft(() => ({ ...initial, landing: { ...initial.landing, nodeSet: initial.landing.nodeSet.id ? initial.landing.nodeSet : allSources(defaultKind) }, via: initial.via.kind === 'node' && !initial.via.ref.nodeSet.id ? { ...initial.via, ref: { ...initial.via.ref, nodeSet: allSources(defaultKind) } } : initial.via }));
  const [viaSearch, setViaSearch] = useState('');
  const [landingSearch, setLandingSearch] = useState('');
  const sourcesFor = (output: SourceKind) => profileNodeSets.filter(s => outputOf(s.ref) === output);
  const previewSources = (scope: ChainNodeSet) => chainSources(scope, draft.nodeSets).map(source => ({ ref: source.ref, name: nodeSetName(source.ref) }));
  const names = useChainNames(chain);
  const whole = !chain.landing.filter && !chain.landing.excludeFilter;
  const viaRef = chain.via.kind === 'node' ? chain.via.ref : undefined;
  const viaAuto = !!viaRef && 'regex' in viaRef.match && !viaRef.match.regex;
  const viaExact = viaRef && 'exact' in viaRef.match ? viaRef.match.exact : undefined;
  const overlapsLanding = !!viaRef && previewSources(viaRef.nodeSet).some(via => previewSources(chain.landing.nodeSet).some(landing => nodeSetKey(via.ref) === nodeSetKey(landing.ref)));
  const error = (chain.landing.filter === NO_NODE_FILTER ? '请至少选择一个落地节点' : undefined) ?? (viaRef && !previewSources(viaRef.nodeSet).length ? '当前前置范围没有节点来源' : !previewSources(chain.landing.nodeSet).length ? '当前落地范围没有节点来源' : undefined) ?? chainInputError(chain) ?? (viaExact && overlapsLanding && names.landingNames.includes(viaExact) ? '前置节点也在落地范围内，会形成循环；请更换前置或取消勾选此节点' : undefined) ?? (viaRef && !viaExact && names.viaEmpty ? '前置范围内没有落地以外的节点，请更换前置或缩小落地范围' : undefined) ?? (draft.chains.some(c => c.id !== chain.id && sameLanding(c.landing, chain.landing)) ? '该落地范围已有代理链，请编辑已有规则' : undefined);
  const choose = (via: ChainTarget) => setChain({ ...chain, via });
  const chooseMatch = (match: NodeRef['match']) => { if (chain.via.kind === 'node') choose({ ...chain.via, ref: { ...chain.via.ref, match } }); };
  const landingText = names.landing;
  const actions = <>{onRemove && <Button className="text-destructive" onClick={onRemove}>移除前置</Button>}<Button onClick={onCancel}>取消{footerTarget ? '前置' : ''}</Button><Button variant="primary" disabled={!!error} onClick={() => onApply(chain)}>{footerTarget ? '应用前置' : '保存'}</Button></>;
  const sourceChoices = <>{(['provider','inline'] as const).map(output => <optgroup key={output} label={output === 'provider' ? '引用来源' : '展开节点'}><option value={`all:${output}`}>{output === 'provider' ? '全部引用来源' : '全部展开节点'}</option>{sourcesFor(output).map(source => <option key={nodeSetKey(source.ref)} value={nodeSetKey(source.ref)}>{source.name} · {output === 'provider' ? '引用' : '展开'}</option>)}</optgroup>)}</>;
  const pickSource = (key: string): ChainNodeSet => key.startsWith('all:') ? allSources(key.slice(4) as SourceKind) : profileNodeSets.find(source => nodeSetKey(source.ref) === key)?.ref ?? emptySet;
  const scopeText = (scope: ChainNodeSet) => scope.type === 'all' ? scope.id === 'provider' ? '全部引用来源' : '全部展开节点' : `${nodeSetName(scope)} · ${outputOf(scope) === 'provider' ? '引用' : '展开'}`;
  return <section aria-label="代理链设置" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-4 sm:grid-cols-2">
      <section aria-label="前置节点" className="flex min-h-0 min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-baseline gap-2"><h3 className="m-0 text-sm font-medium">① 前置</h3><p className="m-0 text-xs text-muted-foreground">先连接这里</p></div>
        <Field label="来源">{id => <Select id={id} aria-label="前置来源" placeholder="选择节点来源或策略组" value={chain.via.kind === 'group' ? 'group' : chain.via.kind === 'builtin' ? 'direct' : nodeSetKey(chain.via.ref.nodeSet)} onChange={event => {
          if (event.target.value === 'group') choose({ kind: 'group', groupId: '' });
          else if (event.target.value === 'direct') choose(initial.via);
          else choose(emptyVia(pickSource(event.target.value)));
        }}>{sourceChoices}<optgroup label="策略组"><option value="group" disabled={!groupOptions.length}>策略组</option></optgroup>{initial.via.kind === 'builtin' && <option value="direct">{initial.via.name}</option>}</Select>}</Field>
        {viaRef && <><div className="chain-node-panel">
          <NodeSearch aria-label="查找前置节点" value={viaSearch} onChange={setViaSearch} />
          <ChoiceRow radio checked={viaAuto} label="自动（按顺序取第一个可用）" onClick={() => chooseMatch({ regex: '' })} />
          <NodeSetPreview nodeSets={previewSources(viaRef.nodeSet)} search={viaSearch} skipNames={viaExact === undefined ? names.landingNames : undefined} selection={viaAuto ? undefined : { match: viaRef.match }} label="前置节点" firstMatch={viaAuto} onSelect={name => chooseMatch({ exact: name })} />
        </div><ConstraintHint>{viaConstraintHint(scopeText(viaRef.nodeSet), viaRef.match)}</ConstraintHint></>}
        {chain.via.kind === 'group' && <div role="group" aria-label="前置策略组" className="chain-node-panel">
          {groupOptions.map(group => <ChoiceRow key={group.id} radio checked={chain.via.kind === 'group' && chain.via.groupId === group.id} label={group.name} onClick={() => choose({ kind: 'group', groupId: group.id })} />)}
        </div>}
      </section>
      <section aria-label="落地节点" className="flex min-h-0 min-w-0 flex-col gap-3 rounded-lg border border-primary/30 bg-muted/50 p-4">
        <div className="flex items-baseline gap-2"><h3 className="m-0 text-sm font-medium">② 落地</h3><p className="m-0 text-xs text-muted-foreground">由它访问目标</p></div>
        {fixedLanding ? <div className="rounded-md bg-muted p-3 text-sm">{landingText}</div> : <>
          <Field label="来源">{id => <Select id={id} aria-label="落地来源" placeholder="选择落地节点来源" value={nodeSetKey(chain.landing.nodeSet)} onChange={event => setChain({ ...chain, landing: { nodeSet: pickSource(event.target.value) } })}>{sourceChoices}</Select>}</Field>
          <div className="chain-node-panel">
            <NodeSearch aria-label="查找落地节点" value={landingSearch} onChange={setLandingSearch} />
            <ChoiceRow checked={whole} label="全部节点" onClick={() => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, ...(whole ? { filter: selectedNodeFilter([]) } : {}) } })} />
            <NodeSetPreview nodeSets={previewSources(chain.landing.nodeSet)} search={landingSearch} selection={{ filter: chain.landing.filter, excludeFilter: chain.landing.excludeFilter }} multiple label="落地节点" onSelect={(_name,_nodeSet,selectedNames) => setChain({ ...chain, landing: { nodeSet: chain.landing.nodeSet, filter: selectedNodeFilter(selectedNames) } })} />
          </div>
          <ConstraintHint>{landingConstraintHint(scopeText(chain.landing.nodeSet), chain.landing)}</ConstraintHint>
        </>}
      </section>
    </div>
    {error && <p role="alert" className="mx-6 mt-0 mb-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p>}
    {footerTarget ? createPortal(actions, footerTarget) : <div data-slot="dialog-footer" className="flex min-h-[61px] shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">{actions}</div>}
  </section>;
}

/** 只用于在列表中查找，不写入代理链。 */
function NodeSearch({ value, onChange, 'aria-label': label }: { value: string; onChange: (value: string) => void; 'aria-label': string }) {
  return <div className="border-b border-border p-2"><SearchInput className="max-w-none" aria-label={label} placeholder={chainPlaceholders.nodeSearch} value={value} onChange={event => onChange(event.target.value)} /></div>;
}

function ConstraintHint({ children }: { children: string }) {
  return <p className="m-0 shrink-0 text-xs text-muted-foreground">{children}</p>;
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
