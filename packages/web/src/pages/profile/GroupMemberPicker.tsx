import { useState } from 'react';
import { chainSources, type GroupMember, type GroupSpec, type NodeSetID } from '@sub-forge/core';
import { Plus, X, LockKeyhole, Link2 } from 'lucide-react';
import { useNodeList } from '../../hooks.ts';
import { useModalPresentation } from '../../modals/index.tsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { BUILTINS, memberLabel } from '../../components/pickers.tsx';
import { Badge, Button, Empty, Field, Input, Segmented, Select, cx } from '../../components/ui.tsx';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { GROUP_TYPE_LABEL } from '../../components/GroupSettingsFields.tsx';
import { useProfile } from './context.ts';
import { canReferenceGroup, memberKey, nodeSetKey, toggleMember } from './memberModel.ts';
import { useChainNames } from './useChainNames.ts';

type Props = { group: GroupSpec; members: GroupMember[]; inherited: GroupMember[]; onChange: (members: GroupMember[]) => void; onGroupChange: (patch: Partial<GroupSpec>) => void; readOnlySettings: boolean };

/** 成员编辑集中于会话副本；候选浮层与右侧预览不创建另一套弹窗。 */
export function GroupMemberPicker({ group, members, inherited, onChange, onGroupChange, readOnlySettings }: Props) {
  const { draft, setDraft, groups, groupName, nodeSetName, profileNodeSets } = useProfile();
  const [category, setCategory] = useState<'source' | 'node' | 'group' | 'builtin'>('source');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const output = (ref: NodeSetID) => draft.nodeSets.find(s => nodeSetKey(s.ref) === nodeSetKey(ref))?.output;
  const inline = profileNodeSets.filter(s => output(s.ref) === 'inline');
  const providers = profileNodeSets.filter(s => output(s.ref) === 'provider');
  const active = inline.find(s => nodeSetKey(s.ref) === source) ?? inline[0];
  const nodes = useModalPresentation(useNodeList(category === 'node' ? active?.ref : undefined, useDebouncedValue(search, 200)));
  const inheritedKeys = new Set(inherited.map(memberKey));
  const selectedKeys = new Set(members.map(memberKey));
  const effective = [...inherited, ...members];
  const effectiveGroups = groups.map(g => ({ ...g, members: [...g.members, ...(draft.routing?.mode === 'bound' ? draft.routing.groupAdditions[g.id] ?? [] : [])] }));
  const allProviders = effective.some(m => m.kind === 'all' && m.scope !== 'proxies');
  const allInline = effective.some(m => m.kind === 'all' && m.scope !== 'providers');
  const previewSets = profileNodeSets.filter(s => effective.some(m => m.kind === 'nodeset' && nodeSetKey(m.ref) === nodeSetKey(s.ref)) || (output(s.ref) === 'provider' ? allProviders : allInline));
  const choose = (member: GroupMember, checked: boolean) => onChange(toggleMember(members, member, checked, inherited));
  const candidate = (member: GroupMember, title: string, subtitle?: string, disabled = false) => {
    const key = memberKey(member), locked = inheritedKeys.has(key), checked = locked || selectedKeys.has(key);
    return <label key={key} className={cx('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[length:var(--text-control)] hover:bg-hover', checked && 'bg-accent-soft', (locked || disabled) && 'cursor-not-allowed')}>
      <input type="checkbox" aria-label={`选择${title}`} checked={checked} disabled={locked || disabled} className="size-4 shrink-0 accent-brand" onChange={event => choose(member, event.target.checked)} />
      <span className="min-w-0 flex-1"><span className="block truncate">{title}</span>{subtitle && <span className="text-[length:var(--text-caption)] text-ink-muted">{subtitle}</span>}</span>{locked && <LockKeyhole size={14} className="text-ink-muted" />}
    </label>;
  };
  const nodeMember = (name: string): GroupMember => ({ kind: 'node', ref: { nodeSet: active!.ref, match: { exact: name }, fallback: 'error' } });
  const memberText = (member: GroupMember) => member.kind === 'all' ? (member.scope === 'providers' ? '全部引用来源' : member.scope === 'proxies' ? '全部展开节点' : '全部节点来源') : memberLabel(member, groupName, nodeSetName).text;
  const memberRow = (member: GroupMember, index: number, handle?: React.ReactNode) => <div className="flex min-h-[44px] items-center gap-2 border-b border-line-2 py-2 text-[length:var(--text-control)] last:border-0">
    {handle ?? <LockKeyhole size={14} className="mx-1 text-ink-muted" />}<div className="min-w-0 flex-1"><span className="block truncate font-medium">{memberText(member)}</span>{member.kind === 'node' && <NodeChainHint nodeSet={member.ref.nodeSet} />}</div>
    {handle && <Button size="sm" variant="ghost" className="w-7 px-0" title={`移除 ${memberText(member)}`} aria-label={`移除 ${memberText(member)}`} onClick={() => onChange(members.filter((_, i) => i !== index))}><X size={14} /></Button>}
  </div>;
  return <div className="grid min-h-0 gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-label="策略组成员">
        <div className="mb-3 flex items-center justify-between"><h3 className="m-0 text-[length:var(--text-section)] font-semibold">成员</h3>
          <Popover><PopoverTrigger asChild><Button size="sm"><Plus size={14} />添加成员</Button></PopoverTrigger>
            <PopoverContent align="start" className="w-[min(420px,calc(100vw-48px))] p-3">
              <div className="flex flex-col gap-3"><Segmented size="sm" label="成员分类" value={category} options={[{ value: 'source', label: '节点来源' }, { value: 'node', label: '单个节点' }, { value: 'group', label: '策略组' }, { value: 'builtin', label: '内置' }]} onChange={category => { setCategory(category); setSearch(''); }} />
                {category === 'node' && inline.length > 0 && <Select placeholder="选择要浏览的节点来源" value={active ? nodeSetKey(active.ref) : ''} onChange={event => setSource(event.target.value)}>{inline.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}
                <SearchInput aria-label="搜索候选成员" placeholder="搜索成员名称" value={search} onChange={event => setSearch(event.target.value)} />
                <div className="max-h-64 overflow-y-auto">
                  {category === 'source' && <>{candidate({ kind: 'all', scope: 'providers' }, '全部引用来源', providers.map(p => p.name).join('、'))}{candidate({ kind: 'all', scope: 'proxies' }, '全部展开节点', inline.map(p => p.name).join('、'))}{profileNodeSets.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(s => candidate({ kind: 'nodeset', ref: s.ref }, s.name, output(s.ref) === 'provider' ? '引用 · 自动更新' : '展开 · 可挑选节点'))}</>}
                  {category === 'node' && <>{nodes.isLoading && <p className="text-[length:var(--text-control)] text-ink-muted">正在加载节点…</p>}{nodes.error && <p role="alert" className="text-[length:var(--text-control)] text-err">{nodes.error.message}<Button size="sm" onClick={() => void nodes.refetch()}>重试</Button></p>}{nodes.data?.nodes.map(n => candidate(nodeMember(n.name), n.name, n.type.toUpperCase()))}{!inline.length && <Empty title="还没有展开来源" />}</>}
                  {category === 'group' && effectiveGroups.filter(g => g.id !== group.id && g.name.toLowerCase().includes(search.toLowerCase())).map(g => candidate({ kind: 'group', groupId: g.id }, g.name, canReferenceGroup(effectiveGroups, group.id, g.id) ? GROUP_TYPE_LABEL[g.type] : '不可添加：会循环引用', !canReferenceGroup(effectiveGroups, group.id, g.id)))}
                  {category === 'builtin' && BUILTINS.filter(n => n.toLowerCase().includes(search.toLowerCase())).map(name => candidate({ kind: 'builtin', name }, name, { DIRECT: '直连', REJECT: '拒绝', 'REJECT-DROP': '静默丢弃', PASS: '继续匹配规则' }[name]))}
                </div>
                {category === 'node' && providers.length > 0 && <div className="border-t border-line-2 pt-3 text-[length:var(--text-caption)] text-ink-muted">{providers.map(p => p.name).join('、')}为引用来源 <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, nodeSets: draft.nodeSets.map(n => n.output === 'provider' ? { ...n, output: 'inline' } : n) })}>改为展开</Button></div>}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {inherited.map((m, i) => <div key={i}>{memberRow(m, i)}</div>)}
        <SortableList items={members} onReorder={onChange} renderItem={(m, i, handle) => memberRow(m, i, handle)} />
        {!effective.length && <Empty title="还没有成员" />}
      </section>
      {previewSets.length > 0 && <section className="border-t border-line-2 pt-4"><h3 className="m-0 mb-3 text-[length:var(--text-section)] font-semibold">筛选 <span className="ml-2 text-[length:var(--text-caption)] font-normal text-ink-muted">作用于来源成员</span></h3>
        <fieldset disabled={readOnlySettings} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
          <Field label="名称包含">{id => <Input id={id} placeholder="保留匹配正则的节点" value={group.filter ?? ''} onChange={event => onGroupChange({ filter: event.target.value || undefined })} />}</Field>
          <Field label="名称排除">{id => <Input id={id} placeholder="排除匹配正则的节点" value={group.excludeFilter ?? ''} onChange={event => onGroupChange({ excludeFilter: event.target.value || undefined })} />}</Field>
          <Field label="排除协议">{id => <ExcludeTypeSelect id={id} disabled={readOnlySettings} value={group.excludeType} onChange={excludeType => onGroupChange({ excludeType })} />}</Field>
        </fieldset>
      </section>}
    </div>
    <aside aria-label="客户端成员预览" className="flex min-w-0 flex-col gap-4 border-t border-line-2 pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
      <h3 className="m-0 text-[length:var(--text-body)] font-medium">客户端里显示</h3>
      {effective.filter(m => m.kind !== 'all' && m.kind !== 'nodeset').map((m, i) => <div key={i} className="flex justify-between gap-2 text-[length:var(--text-control)]"><span className="truncate">{memberText(m)}</span><span className="shrink-0 text-[length:var(--text-caption)] text-ink-muted">{m.kind === 'builtin' ? '内置' : m.kind === 'group' ? '策略组' : nodeSetName(m.ref.nodeSet)}</span></div>)}
      {previewSets.map(s => <div key={nodeSetKey(s.ref)} className="group-preview-list"><div className="mb-2 text-[length:var(--text-caption)] text-ink-muted">{s.name}</div><MatchPreview nodeSet={s.ref} filter={group.filter} excludeFilter={group.excludeFilter} excludeType={group.excludeType} max={8} /></div>)}
      {!effective.length && <p className="m-0 text-[length:var(--text-caption)] text-ink-muted">添加成员后显示预览</p>}
    </aside>
  </div>;
}
function NodeChainHint({ nodeSet }: { nodeSet: NodeSetID }) {
  const { draft } = useProfile();
  const chain = draft.chains.find(c => chainSources(c.landing.nodeSet, draft.nodeSets).some(s => nodeSetKey(s.ref) === nodeSetKey(nodeSet)));
  return chain ? <ChainHint chain={chain} /> : null;
}
function ChainHint({ chain }: { chain: import('@sub-forge/core').ChainRule }) {
  const names = useChainNames(chain);
  return <span className="inline-flex items-center gap-1 text-[length:var(--text-caption)] text-ink-muted"><Link2 size={12} />经由 {names.via} · 在代理链中编辑</span>;
}
