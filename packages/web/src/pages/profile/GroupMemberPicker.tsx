import { useChainNames } from './useChainNames.ts';
import { chainSources } from '@sub-forge/core';
import { useModalPresentation } from '../../modals/index.tsx';
import type { ChainRule, GroupMember, GroupSpec } from '@sub-forge/core';
import { Link2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNodeList } from '../../hooks.ts';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { BUILTINS, memberLabel } from '../../components/pickers.tsx';
import { Badge, Button, Empty, Input, Segmented, Select, Switch, cx } from '../../components/ui.tsx';
import { useProfile } from './context.ts';
import { canReferenceGroup, exactNodeFilter, memberKey, nodeSetKey, toggleMember, putChain } from './memberModel.ts';
import { ChainRuleEditor, chainForLanding } from './ChainRuleEditor.tsx';

type Props = { group: GroupSpec; members: GroupMember[]; inherited: GroupMember[]; onChange: (members: GroupMember[]) => void; onGroupChange: (patch: Partial<GroupSpec>) => void; readOnlySettings: boolean; onChainEditingChange: (editing: boolean) => void; footerTarget: HTMLDivElement | null };

export function GroupMemberPicker({ group, members, inherited, onChange, readOnlySettings, onChainEditingChange, footerTarget }: Props) {
  const { draft, setDraft, groups, groupName, nodeSetName, profileNodeSets } = useProfile();
  const [category, setCategory] = useState<'node' | 'group' | 'builtin'>(() => draft.nodeSets.some(s => s.output === 'inline') ? 'node' : 'builtin');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [editingChain, setEditingChain] = useState<ChainRule>();
  const chainSection = useRef<HTMLDivElement>(null);
  const editChain = (chain?: ChainRule) => { setEditingChain(chain); onChainEditingChange(!!chain); };
  useEffect(() => { if (editingChain) chainSection.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [editingChain]);
  const output = (ref: { type: string; id: string }) => draft.nodeSets.find(s => nodeSetKey(s.ref) === `${ref.type}:${ref.id}`)?.output;
  const inline = profileNodeSets.filter(s => output(s.ref) === 'inline');
  const providers = profileNodeSets.filter(s => output(s.ref) === 'provider');
  const active = inline.find(s => nodeSetKey(s.ref) === source) ?? inline[0];
  const nodeQuery = useNodeList(category === 'node' ? active?.ref : undefined, useDebouncedValue(search, 200));
  const nodes = useModalPresentation(nodeQuery);
  const inheritedKeys = new Set(inherited.map(memberKey));
  const selectedKeys = new Set(members.map(memberKey));
  const effective = [...inherited, ...members];
  const fixed = members.filter(m => m.kind !== 'all' && !(m.kind === 'nodeset' && output(m.ref) === 'provider'));
  const dynamic = members.filter(m => !fixed.includes(m));
  const fixedInherited = inherited.filter(m => m.kind !== 'all' && !(m.kind === 'nodeset' && output(m.ref) === 'provider'));
  const allProviders = effective.some(m => m.kind === 'all' && m.scope !== 'proxies');
  const allInline = effective.some(m => m.kind === 'all' && m.scope !== 'providers');
  const effectiveGroups = groups.map(g => ({ ...g, members: [...g.members, ...(draft.routing?.mode === 'bound' ? draft.routing.groupAdditions[g.id] ?? [] : [])] }));
  const availableGroups = effectiveGroups.filter(g => g.id !== group.id && g.name.toLowerCase().includes(search.toLowerCase()));
  const builtinCandidates = BUILTINS.filter(n => n.toLowerCase().includes(search.toLowerCase()));
  const choose = (member: GroupMember, checked: boolean) => onChange(toggleMember(members, member, checked, inherited));
  const nodeMember = (name: string): GroupMember => ({ kind: 'node', ref: { nodeSet: active!.ref, match: { exact: name }, fallback: 'error' } });
  const candidate = (member: GroupMember, title: string, subtitle?: string, disabled = false) => {
    const key = memberKey(member), locked = inheritedKeys.has(key), checked = locked || selectedKeys.has(key);
    return <label key={key} className={cx('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-[13px] hover:bg-ground', checked && 'bg-accent-soft', (locked || disabled) && 'cursor-not-allowed')}>
      <input type="checkbox" aria-label={`选择${title}`} checked={checked} disabled={locked || disabled} className="h-4 w-4 shrink-0 accent-brand" onChange={e => choose(member, e.target.checked)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="break-words font-medium">{title}</span>{subtitle && <span className="text-[12px] text-ink-muted">{subtitle}</span>}</span>{locked && <Badge>模板</Badge>}
    </label>;
  };
  const setRange = (provider: boolean, proxy: boolean) => {
    const next = members.filter(m => m.kind !== 'all' && !(provider && m.kind === 'nodeset' && output(m.ref) === 'provider'));
    if (provider) next.push({ kind: 'all', scope: 'providers' });
    if (proxy) next.push({ kind: 'all', scope: 'proxies' });
    onChange(next);
  };
  const previewSets = profileNodeSets.filter(s => effective.some(m => m.kind === 'nodeset' && nodeSetKey(m.ref) === nodeSetKey(s.ref)) || (output(s.ref) === 'provider' ? allProviders : allInline));
  const providerFirst = !inline.length && providers.length > 0;
  const fixedSection = <section aria-label="固定成员" className={cx("flex min-w-0 flex-col gap-3", providerFirst && "border-t border-line pt-4")}>
      <div><h3 className="m-0 text-[14px] font-semibold">固定成员</h3><p className="mt-1 mb-0 text-[12px] text-ink-muted">勾选 Inline 节点、策略组或内置策略，可批量添加。</p></div>
      {!inline.length && <p className="m-0 text-[12px] text-ink-muted">{providers.length ? "当前节点集均以 Provider 输出，已在上方提供引用入口。添加单个节点需将对应节点集改为 Inline。" : "本订阅尚未加入节点集。仍可添加内置策略和其他策略组。"}</p>}
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line">
          <div className="flex flex-col gap-2 border-b border-line p-2"><Segmented label="成员分类" value={category} options={[{ value: 'node', label: 'Inline 节点', disabled: !inline.length, title: !inline.length ? '本订阅没有 Inline 节点集' : undefined }, { value: 'group', label: '策略组' }, { value: 'builtin', label: '内置策略' }]} onChange={c => { setCategory(c); setSearch(''); }} />
            {category === 'node' && !!inline.length && <Select placeholder="选择要浏览并添加成员的 Inline 节点集" aria-label="Inline 节点集" value={active ? nodeSetKey(active.ref) : ''} onChange={e => { setSource(e.target.value); setSearch(''); }}>{inline.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}
            <Input aria-label="搜索候选成员" placeholder={category === 'node' ? '搜索节点名称' : category === 'group' ? '搜索策略组名称' : '搜索内置策略，如 DIRECT'} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className={cx("max-h-56 min-h-40 overflow-y-auto p-2", category === 'builtin' && 'grid grid-cols-2 content-start gap-1')}>
            {category === 'node' && <><>{nodes.error && <div role="alert" className="p-2 text-[12px] text-err">节点加载失败：{nodes.error.message}<Button size="sm" variant="ghost" onClick={() => void nodes.refetch()}>重新加载</Button></div>}</>{!active && <Empty variant="plain" title="还没有 Inline 节点集" description="在订阅的节点来源中，将所需节点集设为 Inline。" />}{nodes.isLoading && <p className="text-[13px] text-ink-muted">正在加载节点…</p>}{nodes.data?.nodes.map(n => candidate(nodeMember(n.name), n.name, n.type.toUpperCase()))}{active && nodes.data && !nodes.data.nodes.length && <Empty variant="plain" title="没有匹配节点" />}{nodes.data?.truncated && <p className="text-[12px] text-ink-muted">仅展示部分结果，请搜索缩小范围。</p>}</>}
            {category === 'group' && <>{availableGroups.map(g => candidate({ kind: 'group', groupId: g.id }, g.name, canReferenceGroup(effectiveGroups, group.id, g.id) ? g.type.toUpperCase() : '不可添加：会循环引用当前组', !canReferenceGroup(effectiveGroups, group.id, g.id)))}{!availableGroups.length && <Empty variant="plain" title={search ? "没有匹配的策略组" : "没有其他策略组"} description={search ? "试试其他名称。" : "可以添加内置策略，或在动态成员中引用 Provider。"} />}</>}
            {category === 'builtin' && builtinCandidates.map(name => candidate({ kind: 'builtin', name }, name, { DIRECT: '直连', REJECT: '拒绝', 'REJECT-DROP': '静默丢弃', PASS: '继续匹配规则' }[name]))}
            {category === 'builtin' && !builtinCandidates.length && <Empty variant="plain" className="col-span-2" title="没有匹配的内置策略" description="试试 DIRECT 或 REJECT。" />}
          </div>
          {category === 'node' && !!nodes.data?.nodes.length && <div className="border-t border-line p-2"><Button size="sm" variant="ghost" onClick={() => { let next = members; for (const n of nodes.data!.nodes) next = toggleMember(next, nodeMember(n.name), true, inherited); onChange(next); }}>添加当前 {nodes.data.nodes.length} 个结果</Button></div>}
        </div>
        <div className="flex min-w-0 flex-col rounded-lg border border-line"><div className="flex items-center justify-between border-b border-line px-3 py-2.5"><strong className="text-[13px]">固定成员 {fixed.length + fixedInherited.length} 项</strong><span className="text-[12px] text-ink-muted">拖动排序</span></div>
          <div className="max-h-80 min-h-40 overflow-y-auto px-2">
            {fixedInherited.map((m, i) => <div key={i} className="flex items-center gap-2 border-b border-line-2 px-2 py-3 text-[13px]"><Badge>模板</Badge><span className="break-all">{memberLabel(m, groupName, nodeSetName).text}</span></div>)}
            <SortableList items={fixed} onReorder={next => onChange([...next, ...dynamic])} renderItem={(m, i, handle) => {
              const label = memberLabel(m, groupName, nodeSetName);
              const legacyProvider = m.kind === 'node' && output(m.ref.nodeSet) !== 'inline';
              const landing = m.kind === 'node' ? { nodeSet: m.ref.nodeSet, filter: 'exact' in m.ref.match ? exactNodeFilter(m.ref.match.exact) : m.ref.match.regex } : undefined;
              const relevant = landing ? draft.chains.filter(c => chainSources(c.landing.nodeSet, draft.nodeSets).some(source => nodeSetKey(source.ref) === nodeSetKey(landing.nodeSet))) : [];
              const whole = relevant.find(c => !c.landing.filter && !c.landing.excludeFilter);
              const exact = landing ? relevant.find(c => c.landing.filter === landing.filter && !c.landing.excludeFilter) : undefined;
              return <div className="border-b border-line-2 py-2 last:border-0"><div className="flex items-center gap-1">{handle}<span className="min-w-0 flex-1 break-words text-[13px] font-medium">{label.text}</span><Button size="sm" variant="ghost" aria-label={`移除 ${label.text}`} onClick={() => onChange([...fixed.filter((_, j) => i !== j), ...dynamic])}><X size={14} /></Button></div>
                {legacyProvider && <p className="ml-7 text-[12px] text-warn">历史 Provider 节点引用。请在动态成员中引用 Provider，或将节点集切换为 Inline。</p>}
                {landing && !legacyProvider && <Button size="sm" variant="ghost" className="ml-5 max-w-[calc(100%-20px)] whitespace-normal text-left text-brand" disabled={!!whole} onClick={() => editChain(chainForLanding(draft.chains, landing))}><Link2 size={13} className="shrink-0" />{whole ? <>整集前置：<ChainViaName chain={whole} /></> : exact ? <>前置：<ChainViaName chain={exact} /></> : relevant.length ? '查看 / 设置节点前置' : '设置前置'}</Button>}
              </div>;
            }} />
            {!fixed.length && !fixedInherited.length && <Empty variant="plain" title="尚未添加固定成员" description="勾选左侧成员即可添加；Provider 在动态成员中配置。" />}
          </div>
        </div>
      </div>
    </section>;
  const dynamicSection = <section aria-label="Provider 与动态成员" className={cx("flex flex-col gap-3", !providerFirst && "border-t border-line pt-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-[14px] font-semibold">Provider 与动态成员</h3><Badge>统一筛选</Badge></div>
      <Segmented label="Provider 范围" value={allProviders ? 'all' : 'selected'} options={[{ value: 'selected', label: '指定 Provider', disabled: inherited.some(m => m.kind === 'all' && m.scope !== 'proxies') }, { value: 'all', label: '全部 Provider', disabled: inherited.some(m => m.kind === 'nodeset') }]} onChange={v => setRange(v === 'all', allInline)} />
      {allProviders ? <p className="m-0 text-[12px] text-ink-muted">包含本订阅所有 Provider，并随其节点更新。</p> : <div className="flex flex-wrap gap-2">{providers.map(p => { const m: GroupMember = { kind: 'nodeset', ref: p.ref }; const k = memberKey(m); return <label key={k} className={cx("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px]", inheritedKeys.has(k) || selectedKeys.has(k) ? "border-brand bg-accent-soft" : "border-line")}><input type="checkbox" aria-label={`引用 Provider ${p.name}`} className="accent-brand" checked={inheritedKeys.has(k) || selectedKeys.has(k)} disabled={inheritedKeys.has(k)} onChange={e => choose(m, e.target.checked)} />{p.name}{inheritedKeys.has(k) && <Badge>模板</Badge>}</label>; })}{!providers.length && <span className="text-[12px] text-ink-muted">尚未加入 Provider 节点集。</span>}</div>}
      <fieldset disabled={inherited.some(m => m.kind === 'all' && m.scope !== 'providers')} className="m-0 border-0 p-0"><label className="flex items-center gap-2 text-[13px]"><Switch disabled={inherited.some(m => m.kind === 'all' && m.scope !== 'providers') || !inline.length} label="自动包含全部 Inline 节点" checked={allInline} onChange={v => setRange(allProviders, v)} />同时自动包含全部 Inline 节点</label></fieldset>
      <p className="m-0 text-[12px] text-ink-muted">{readOnlySettings ? '筛选条件继承模板。' : ''}所有动态来源共享这套筛选；filter 不筛选手动加入的固定成员。</p>
      {!!previewSets.length && <div className="grid gap-3 rounded-lg bg-ground p-3 sm:grid-cols-2">{previewSets.map(s => <div key={nodeSetKey(s.ref)} className="flex min-w-0 flex-col gap-2"><strong className="text-[12px]">{s.name} · 当前快照</strong><MatchPreview nodeSet={s.ref} filter={group.filter} excludeFilter={group.excludeFilter} excludeType={group.excludeType} max={6} /></div>)}</div>}
    </section>;
  return <div className="flex min-w-0 flex-col gap-5">
    {providerFirst && dynamicSection}
    {fixedSection}
    {editingChain && <div ref={chainSection} className="border-t border-line pt-4"><h3 className="mt-0 mb-3 text-[14px] font-semibold">设置节点前置</h3><ChainRuleEditor footerTarget={footerTarget} key={editingChain.id} initial={editingChain} fixedLanding onCancel={() => editChain(undefined)} onApply={chain => { setDraft({ ...draft, chains: putChain(draft.chains, chain) }); editChain(undefined); }} onRemove={draft.chains.some(c => c.id === editingChain.id) ? () => { setDraft({ ...draft, chains: draft.chains.filter(c => c.id !== editingChain.id) }); editChain(undefined); } : undefined} /></div>}
    {!providerFirst && dynamicSection}
  </div>;
}

function ChainViaName({ chain }: { chain: ChainRule }) {
  return useChainNames(chain).via;
}
