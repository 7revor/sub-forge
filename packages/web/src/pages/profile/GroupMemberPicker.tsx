import { useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { nodeListOptions } from '../../hooks.ts';
import { filterNodes } from '../../components/nodeMatch.ts';
import { chainSources, type GroupMember, type GroupSpec, type NodeSetID } from '@sub-forge/core';
import { Plus, X, LockKeyhole, Link2, Layers, Server, Crosshair } from 'lucide-react';
import { useNodeList } from '../../hooks.ts';
import { useModalPresentation } from '../../modals/index.tsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { BUILTINS, memberLabel } from '../../components/pickers.tsx';
import { Badge, Button, Empty, Segmented, Select, cx } from '../../components/ui.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { GROUP_TYPE_LABEL } from '../../components/GroupSettingsFields.tsx';
import { useProfile } from './context.ts';
import { canReferenceGroup, memberKey, nodeSetKey, toggleMember } from './memberModel.ts';
import { useChainNames } from './useChainNames.ts';
import { Checkbox } from '../../components/ui/checkbox.tsx';

type Props = { group: GroupSpec; members: GroupMember[]; inherited: GroupMember[]; onChange: (members: GroupMember[]) => void; advanced?: ReactNode };

/** 成员编辑集中于会话副本；候选浮层与右侧预览不创建另一套弹窗。 */
export function GroupMemberPicker({ group, members, inherited, onChange, advanced }: Props) {
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
    return <label key={key} className={cx('flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent', checked && 'bg-primary/10', (locked || disabled) && 'cursor-not-allowed')}>
      <Checkbox aria-label={`选择${title}`} checked={checked} disabled={locked || disabled} onCheckedChange={value => choose(member, value === true)} />
      <span className="min-w-0 flex-1"><span className="block truncate">{title}</span>{subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}</span>{locked && <LockKeyhole size={14} className="text-muted-foreground" />}
    </label>;
  };
  const nodeMember = (name: string): GroupMember => ({ kind: 'node', ref: { nodeSet: active!.ref, match: { exact: name }, fallback: 'error' } });
  const memberText = (member: GroupMember) => member.kind === 'all' ? (member.scope === 'providers' ? '全部引用来源' : member.scope === 'proxies' ? '全部展开节点' : '全部节点来源') : memberLabel(member, groupName, nodeSetName).text;
  const memberRow = (member: GroupMember, index: number, handle?: ReactNode) => <div className="my-2 grid min-h-[44px] grid-cols-[20px_28px_minmax(0,1fr)_28px] items-center gap-2.5 rounded-[10px] border border-border px-3 py-1.5 text-sm">
    {handle ?? <LockKeyhole size={14} className="text-muted-foreground" />}
    <span className={cx('grid size-7 place-items-center rounded-md', member.kind === 'node' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground')}>{member.kind === 'builtin' ? <span className="text-xs font-semibold">{member.name.slice(0,2)}</span> : member.kind === 'node' ? <Crosshair size={14} /> : member.kind === 'group' ? <Layers size={14} /> : <Server size={14} />}</span>
    <div className="min-w-0"><span className="block truncate">{memberText(member)}</span>{member.kind === 'node' && <NodeChainHint nodeSet={member.ref.nodeSet} />}</div>
    {handle ? <Button size="sm" variant="ghost" className="w-7 px-0" title={`移除 ${memberText(member)}`} aria-label={`移除 ${memberText(member)}`} onClick={() => onChange(members.filter((_, i) => i !== index))}><X size={14} /></Button> : <span />}
  </div>;
  return <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_360px] md:overflow-hidden">
    <div className="flex min-h-0 min-w-0 flex-col gap-5 p-5 md:overflow-y-auto md:border-r md:border-border">
      <section aria-label="策略组成员">
        <div className="mb-2 flex items-center justify-between"><h3 className="m-0 text-sm font-medium">成员</h3>
          <Popover><PopoverTrigger asChild><Button size="sm"><Plus size={14} />添加成员</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-[min(380px,calc(100vw-48px))] p-3">
              <div className="flex flex-col gap-3"><Segmented size="sm" label="成员分类" value={category} options={[{ value: 'source', label: '节点来源' }, { value: 'node', label: '单个节点' }, { value: 'group', label: '策略组' }, { value: 'builtin', label: '内置' }]} onChange={category => { setCategory(category); setSearch(''); }} />
                {category === 'node' && inline.length > 0 && <Select placeholder="选择要浏览的节点来源" value={active ? nodeSetKey(active.ref) : ''} onChange={event => setSource(event.target.value)}>{inline.map(s => <option key={nodeSetKey(s.ref)} value={nodeSetKey(s.ref)}>{s.name}</option>)}</Select>}
                <SearchInput aria-label="搜索候选成员" placeholder="搜索成员名称" value={search} onChange={event => setSearch(event.target.value)} />
                <div className="max-h-64 overflow-y-auto">
                  {category === 'source' && <>{candidate({ kind: 'all', scope: 'providers' }, '全部引用来源', providers.map(p => p.name).join('、'))}{candidate({ kind: 'all', scope: 'proxies' }, '全部展开节点', inline.map(p => p.name).join('、'))}{profileNodeSets.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(s => candidate({ kind: 'nodeset', ref: s.ref }, s.name, output(s.ref) === 'provider' ? '引用 · 自动更新' : '展开 · 可挑选节点'))}</>}
                  {category === 'node' && <>{nodes.isLoading && <p className="text-sm text-muted-foreground">正在加载节点…</p>}{nodes.error && <p role="alert" className="text-sm text-destructive">{nodes.error.message}<Button size="sm" onClick={() => void nodes.refetch()}>重试</Button></p>}{nodes.data?.nodes.map(n => candidate(nodeMember(n.name), n.name, n.type.toUpperCase()))}{!inline.length && <Empty title="还没有展开来源" />}</>}
                  {category === 'group' && effectiveGroups.filter(g => g.id !== group.id && g.name.toLowerCase().includes(search.toLowerCase())).map(g => candidate({ kind: 'group', groupId: g.id }, g.name, canReferenceGroup(effectiveGroups, group.id, g.id) ? GROUP_TYPE_LABEL[g.type] : '不可添加：会循环引用', !canReferenceGroup(effectiveGroups, group.id, g.id)))}
                  {category === 'builtin' && BUILTINS.filter(n => n.toLowerCase().includes(search.toLowerCase())).map(name => candidate({ kind: 'builtin', name }, name, { DIRECT: '直连', REJECT: '拒绝', 'REJECT-DROP': '静默丢弃', PASS: '继续匹配规则' }[name]))}
                </div>
                {category === 'node' && providers.length > 0 && <div className="border-t border-border pt-3 text-xs text-muted-foreground">{providers.map(p => p.name).join('、')}为引用来源 <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, nodeSets: draft.nodeSets.map(n => n.output === 'provider' ? { ...n, output: 'inline' } : n) })}>改为展开</Button></div>}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {inherited.map((m, i) => <div key={i}>{memberRow(m, i)}</div>)}
        <SortableList items={members} onReorder={onChange} renderItem={(m, i, handle) => memberRow(m, i, handle)} />
        {!effective.length && <Empty title="还没有成员" />}
      </section>
      {advanced}
    </div>
    <MemberPreview effective={effective} sources={previewSets} group={group} memberText={memberText} nodeSetName={nodeSetName} />
  </div>;
}
function MemberPreview({ effective, sources, group, memberText, nodeSetName }: { effective: GroupMember[]; sources: { ref: NodeSetID; name: string }[]; group: GroupSpec; memberText: (member: GroupMember) => string; nodeSetName: (ref: NodeSetID) => string }) {
  const queries = useQueries({ queries: sources.map(source => nodeListOptions(source.ref)) });
  const view = useModalPresentation({ loading: queries.some(query => query.isLoading), truncated: queries.some(query => query.data?.truncated), errors: queries.flatMap(query => query.error ? [query.error.message] : []), rows: queries.flatMap((query, i) => filterNodes(query.data?.nodes ?? [], { filter: group.filter, excludeFilter: group.excludeFilter, excludeType: group.excludeType }).nodes.map(node => ({ name: node.name, source: sources[i]!.name }))), total: queries.reduce((sum, query) => sum + (query.data?.total ?? 0), 0) });
  const direct = effective.filter(member => member.kind !== 'all' && member.kind !== 'nodeset');
  return <aside aria-label="客户端成员预览" className="flex min-h-0 min-w-0 flex-col border-t border-border bg-muted/50 md:border-t-0">
    <div className="flex items-baseline justify-between px-5 pt-5 pb-3"><h3 className="m-0 text-sm font-medium">客户端里显示</h3><span className="text-xs text-muted-foreground">{direct.length + view.rows.length} 项</span></div>
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3 text-sm">
      {direct.map((member, i) => <div key={i} className="flex justify-between gap-2 rounded-md px-2 py-[7px]"><span className="truncate">{memberText(member)}</span><span className="shrink-0 text-xs text-muted-foreground">{member.kind === 'builtin' ? '内置' : member.kind === 'group' ? '策略组' : member.kind === 'node' ? nodeSetName(member.ref.nodeSet) : ''}</span></div>)}
      {!!direct.length && !!view.rows.length && <div className="mx-2 my-1 h-px bg-border" />}
      {view.rows.slice(0,8).map((node,i) => <div key={i} className="flex justify-between gap-2 px-2 py-[7px]"><span className="truncate">{node.name}</span><span className="shrink-0 text-xs text-muted-foreground">{node.source}</span></div>)}
      {view.rows.length > 8 && <span className="px-2 py-[7px] text-xs text-muted-foreground">另 {view.rows.length - 8} 个</span>}
      {view.loading && <span className="px-2 text-muted-foreground">正在加载…</span>}{view.errors.map((error,i) => <span role="alert" key={i} className="px-2 text-destructive">{error}</span>)}{view.errors.length > 0 && <Button size="sm" onClick={() => void Promise.allSettled(queries.map(query => query.refetch()))}>重新加载</Button>}{view.truncated && <p className="px-2 text-warn">预览列表已截断，命中数量仅统计当前返回的节点；完整结果以生成配置为准。</p>}
      {!effective.length && <span className="px-2 text-muted-foreground">添加成员后显示预览</span>}
    </div>
    {!!sources.length && <div className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">{view.total} 个来源节点中命中 {view.rows.length} 个</div>}
  </aside>;
}

function NodeChainHint({ nodeSet }: { nodeSet: NodeSetID }) {
  const { draft } = useProfile();
  const chain = draft.chains.find(c => chainSources(c.landing.nodeSet, draft.nodeSets).some(s => nodeSetKey(s.ref) === nodeSetKey(nodeSet)));
  return chain ? <ChainHint chain={chain} /> : null;
}
function ChainHint({ chain }: { chain: import('@sub-forge/core').ChainRule }) {
  const names = useChainNames(chain);
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Link2 size={12} />经由 {names.via} · 在代理链中编辑</span>;
}
