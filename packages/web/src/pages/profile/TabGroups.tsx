import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { Notice } from '../../components/Notice.tsx';
import { OptionalBoolean } from '../../components/OptionalBoolean.tsx';
// 策略组：填充模板组（只能加成员、调整类型与测速参数，不能删除、改名或隐藏，PRF-09），管理私有组。

import type { Builtin, GroupMember, GroupSpec, NodeSetID } from '@sub-forge/core';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BUILTINS, NodeSetSelect, memberLabel } from '../../components/pickers.tsx';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { NodePicker } from '../../components/NodePicker.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Badge, Button, Card, Empty, Field, Input, Segmented, Select, cx } from '../../components/ui.tsx';
import { useProfile } from './context.ts';
import { reorderExtraGroups } from './groupOrder.ts';
import { createRegionGroups, REGION_GROUPS } from '../../convert/regionGroups.ts';

type Editable = Pick<GroupSpec, 'type' | 'filter' | 'excludeFilter' | 'excludeType' | 'test' | 'strategy' | 'display' | 'extra'>;

function MemberAdder({ onAdd, excludeGroupId }: { onAdd: (m: GroupMember) => void; excludeGroupId: string }) {
  const { profileNodeSets, groupOptions } = useProfile();
  const [kind, setKind] = useState<GroupMember['kind']>('nodeset');
  const [ns, setNs] = useState<NodeSetID | undefined>(profileNodeSets[0]?.ref);
  const [groupId, setGroupId] = useState('');
  const [scope, setScope] = useState<Extract<GroupMember, { kind: 'all' }>['scope']>('all');
  const [builtin, setBuiltin] = useState<Builtin>('DIRECT');
  const [node, setNode] = useState<{ kind: 'node'; ref: import('@sub-forge/core').NodeRef }>({ kind: 'node', ref: { nodeSet: profileNodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
  const groups = groupOptions.filter((g) => g.id !== excludeGroupId);

  const add = () => {
    if (kind === 'nodeset' && ns) onAdd({ kind: 'nodeset', ref: ns });
    else if (kind === 'group' && (groupId || groups[0])) onAdd({ kind: 'group', groupId: groupId || groups[0]!.id });
    else if (kind === 'builtin') onAdd({ kind: 'builtin', name: builtin });
    else if (kind === 'node' && ('exact' in node.ref.match ? node.ref.match.exact : node.ref.match.regex)) onAdd({ kind: 'node', ref: node.ref });
    else if (kind === 'all') onAdd({ kind: 'all', scope });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ground p-2.5">
      <Select aria-label="成员类型" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value as GroupMember['kind'])}>
        <option value="nodeset">节点集</option>
        <option value="group">其他组</option>
        <option value="builtin">内置策略</option>
        <option value="node">单个节点</option>
        <option value="all">全部节点</option>
      </Select>
      {kind === 'nodeset' && <div className="min-w-48"><NodeSetSelect label="节点集" value={ns} options={profileNodeSets} onChange={setNs} placeholder={profileNodeSets.length ? '选择节点集' : '先在「节点集」中加入'} /></div>}
      {kind === 'group' && <Select aria-label="组" className="w-auto min-w-40" value={groupId || groups[0]?.id || ''} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}
      {kind === 'builtin' && <Select aria-label="内置策略" className="w-auto" value={builtin} onChange={(e) => setBuiltin(e.target.value as Builtin)}>{BUILTINS.map((b) => <option key={b}>{b}</option>)}</Select>}
      {kind === 'node' && <NodePicker label="节点" value={node.ref} nodeSets={profileNodeSets} onChange={(ref) => setNode({ kind: 'node', ref })} />}
      {kind === 'all' && <Select aria-label="全部节点范围" className="w-auto" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="all">全部</option><option value="proxies">本地节点</option><option value="providers">provider</option></Select>}
      <Button size="sm" onClick={add}><Plus size={14} />添加成员</Button>
    </div>
  );
}

export function TabGroups() {
  const { draft, groups, template, patchOverlay, groupName, nodeSetName, profileNodeSets } = useProfile();
  const [regionSource, setRegionSource] = useState<NodeSetID>();
  const regionNodeSet = profileNodeSets.find(option => option.ref.type === regionSource?.type && option.ref.id === regionSource.id)
    ?? profileNodeSets.find(option => option.name === 'FlowerCloud') ?? profileNodeSets[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(groups[0]?.id);
  const [previewSelection, setPreviewSelection] = useState<{ groupId: string; key: string }>();
  const templateIds = (template?.groups ?? []).map((group) => group.id);
  const g = groups.find((x) => x.id === selectedId) ?? groups[0];
  const patch = g && g.origin === 'template' ? draft.overlay.groupPatches?.[g.id] ?? {} : {};
  const eff: (GroupSpec & { origin: string }) | undefined = g && (g.origin === 'template' ? { ...g, ...(patch.set ?? {}), members: g.members } : g);
  const added: GroupMember[] = g ? (g.origin === 'template' ? patch.addMembers ?? [] : g.members) : [];
  const allMembers = g?.origin === 'template' ? [...g.members, ...added] : added;
  const previewNodeSets = [...new Map(allMembers.flatMap((member) => member.kind === 'nodeset' ? [[`${member.ref.type}:${member.ref.id}`, member.ref] as const] : [])).entries()];
  const previewNodeSet = previewNodeSets.find(([key]) => previewSelection?.groupId === g?.id && previewSelection?.key === key) ?? previewNodeSets[0];
  const orphans = Object.keys(draft.overlay.groupPatches ?? {}).filter((id) => !template?.groups.some((t) => t.id === id));

  const setField = <K extends keyof Editable>(k: K, v: Editable[K] | undefined) => {
    if (!g) return;
    if (g.origin === 'template') {
      patchOverlay((o) => {
        const p = o.groupPatches?.[g.id] ?? {};
        const set = { ...(p.set ?? {}) } as Record<string, unknown>;
        // 清空协议多选意味着覆盖为“不排除”，不能删除覆盖项后又继承模板的排除协议。
        if (k === 'excludeType') set[k] = v ?? '';
        else if (v === undefined || v === '') delete set[k]; else set[k] = v;
        return { ...o, groupPatches: { ...o.groupPatches, [g.id]: { ...p, set } } };
      });
    } else {
      patchOverlay((o) => ({ ...o, extraGroups: (o.extraGroups ?? []).map((e) => (e.group.id === g.id ? { ...e, group: { ...e.group, [k]: v === '' ? undefined : v } } : e)) }));
    }
  };
  const setMembers = (members: GroupMember[]) => {
    if (!g) return;
    if (g.origin === 'template') patchOverlay((o) => ({ ...o, groupPatches: { ...o.groupPatches, [g.id]: { ...(o.groupPatches?.[g.id] ?? {}), addMembers: members } } }));
    else patchOverlay((o) => ({ ...o, extraGroups: (o.extraGroups ?? []).map((e) => (e.group.id === g.id ? { ...e, group: { ...e.group, members } } : e)) }));
  };
  const addPrivate = () => {
    const id = `g_${Date.now().toString(36)}`;
    patchOverlay((o) => ({ ...o, extraGroups: [...(o.extraGroups ?? []), { group: { id, name: '新的组', type: 'select', members: [] } }] }));
    setSelectedId(id);
  };
  const addRegions = () => {
    const added = createRegionGroups(groups, regionNodeSet?.ref);
    const inherited = groups.filter(group => group.origin === 'template' && REGION_GROUPS.some(region => region.name === group.name));
    patchOverlay(o => {
      const groupPatches = { ...o.groupPatches };
      if (regionNodeSet) for (const group of inherited) {
        const previous = groupPatches[group.id] ?? {};
        const members = [...group.members, ...(previous.addMembers ?? [])];
        if (members.some(member => member.kind === 'nodeset' && member.ref.type === regionNodeSet.ref.type && member.ref.id === regionNodeSet.ref.id)) continue;
        groupPatches[group.id] = { ...previous, addMembers: [...(previous.addMembers ?? []), { kind: 'nodeset', ref: { ...regionNodeSet.ref } }] };
      }
      return { ...o, groupPatches, extraGroups: [...(o.extraGroups ?? []), ...added.map(group => ({ group }))] };
    });
    setSelectedId(added[0]?.id ?? inherited[0]?.id);
  };
  const removePrivate = () => {
    if (!g || g.origin !== 'profile') return;
    patchOverlay((o) => ({ ...o, extraGroups: reorderExtraGroups(templateIds, groups.filter((x) => x.id !== g.id).map((x) => x.id), (o.extraGroups ?? []).filter((e) => e.group.id !== g.id)) }));
    setSelectedId(groups[0]?.id);
  };
  const totalMembers = (x: typeof groups[number]) => x.origin === 'template' ? x.members.length + (draft.overlay.groupPatches?.[x.id]?.addMembers?.length ?? 0) : x.members.length;

  const templateMembers = g?.origin === 'template' && <ul className="m-0 list-none p-0">
    {g.members.map((m, i) => {
      const l = memberLabel(m, groupName, nodeSetName);
      return <li key={i} className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-2.5"><Badge>{l.kind}</Badge><span className="text-[13.5px]">{l.text}</span><span className="ml-auto flex items-center gap-1 text-[12px] text-muted"><Lock size={12} />来自模板</span></li>;
    })}
  </ul>;

  return (
    <>
      {orphans.length > 0 && (
        <Notice tone="warn" actions={<Button size="sm" onClick={() => patchOverlay((o) => ({ ...o, groupPatches: Object.fromEntries(Object.entries(o.groupPatches ?? {}).filter(([id]) => !orphans.includes(id))) }))}>清理</Button>}><span className="text-[13px]"><b>{orphans.length} 个孤儿覆盖项不再输出：</b>模板已删除这些组（{orphans.join('、')}），对它们的填充已失效。</span></Notice>
      )}
      <div className="flex flex-wrap items-start gap-5">
        <Card title="策略组" className="min-w-0 flex-[1_1_300px]" bodyClass="px-4 pb-2">
          {templateIds.length > 0 && <p className="mt-0 text-[12px] text-muted">模板组顺序固定；私有组不能放在第一个模板组之前。</p>}
          <div className="-mx-4"><SortableList items={groups} getKey={(x) => x.id} isLocked={(x) => x.origin === 'template'}
            canDrop={(_from, to) => !templateIds.length || to > 0}
            onReorder={(ordered) => patchOverlay((o) => ({ ...o, extraGroups: reorderExtraGroups(templateIds, ordered.map((x) => x.id), o.extraGroups ?? []) }))}
            renderItem={(x, _index, handle) => {
              const n = totalMembers(x);
              const current = x.origin === 'template' ? { ...x, ...draft.overlay.groupPatches?.[x.id]?.set } : x;
              return (
                <div className={cx('flex items-center gap-1 border-t border-line-2 px-2', x.id === g?.id ? 'bg-accent-soft' : 'bg-panel hover:bg-ground')}>
                  {handle}
                  <button type="button" onClick={() => setSelectedId(x.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-2.5 text-left">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13.5px] font-medium">{x.name}</span>
                      <span className="text-[12px] text-muted">{current.type.toUpperCase()} · {x.origin === 'template' ? '模板组' : '私有组'}</span>
                    </span>
                    {n === 0 ? <Badge tone="warn">空 · REJECT</Badge> : <span className="font-mono text-[12px] text-ink-2">{n} 成员</span>}
                  </button>
                </div>
              );
            }} /></div>
          {!groups.length && <Empty title="没有组" />}
          <div className="-mx-4 mt-4 flex flex-col gap-2 border-t border-line-2 px-4 pt-2.5">
            <NodeSetSelect label="地区节点来源" value={regionNodeSet?.ref} options={profileNodeSets} onChange={setRegionSource} placeholder="先在「节点集」中加入" />
            <Button onClick={addRegions}><Plus size={15} />添加地区节点</Button>
            <Button className="w-full border-dashed" onClick={addPrivate}><Plus size={15} />新增私有组</Button>
          </div>
        </Card>

        {g && eff && (
          <Card className="min-w-0 flex-[999_1_560px]"
            title={<div className="flex flex-col gap-1">
              <h2 className="m-0 text-lg font-semibold">{g.origin === 'template' ? g.name : <Input aria-label="组名" value={g.name} onChange={(e) => patchOverlay((o) => ({ ...o, extraGroups: (o.extraGroups ?? []).map((x) => (x.group.id === g.id ? { ...x, group: { ...x.group, name: e.target.value } } : x)) }))} />}</h2>
              <span className="text-[12.5px] text-muted">{g.origin === 'template' ? '模板组' : '私有组'}</span>
            </div>}
            actions={g.origin === 'template' ? (g.hint ? <Badge>模板提示：{g.hint}</Badge> : undefined) : <Button variant="danger" size="sm" onClick={removePrivate}><Trash2 size={14} />删除组</Button>}>
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                <GroupSettingsFields value={eff} onChange={setField} defaultStrategy="consistent-hashing" />
              </div>

              <div className="flex flex-col gap-2.5">
                <span className="text-[14px] font-semibold">成员</span>
                {g.origin === 'template' && <Segmented label="追加成员位置" value={patch.memberOrder ?? 'append'}
                  options={[{ value: 'prepend', label: '追加成员放在模板成员之前' }, { value: 'append', label: '追加成员放在模板成员之后' }]}
                  onChange={(memberOrder) => patchOverlay((o) => ({ ...o, groupPatches: { ...o.groupPatches, [g.id]: { ...o.groupPatches?.[g.id], memberOrder } } }))} />}
                <div className="flex flex-col overflow-hidden rounded-lg border border-line">
                  {patch.memberOrder !== 'prepend' && templateMembers}
                  <SortableList key={g.id} items={added} onReorder={setMembers} renderItem={(m, i, handle) => {
                    const l = memberLabel(m, groupName, nodeSetName);
                    return <div className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-2.5">
                      {handle}<Badge tone="accent">{l.kind}</Badge><span className="text-[13.5px] font-medium">{l.text}</span>
                      <Button size="sm" variant="ghost" className="ml-auto" aria-label={`移除 ${l.text}`} onClick={() => setMembers(added.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
                    </div>;
                  }} />
                  {patch.memberOrder === 'prepend' && templateMembers}
                  {!allMembers.length && <div className="p-3.5"><Empty title="没有成员" /></div>}
                </div>
                <MemberAdder key={g.id} excludeGroupId={g.id} onAdd={(m) => setMembers([...added, m])} />
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                <Field label="filter（保留）" hint="仅筛选节点集成员">{(id) => <Input id={id} className="font-mono" value={eff.filter ?? ''} onChange={(e) => setField('filter', e.target.value)} />}</Field>
                <Field label="exclude-filter（剔除）">{(id) => <Input id={id} className="font-mono" value={eff.excludeFilter ?? ''} onChange={(e) => setField('excludeFilter', e.target.value)} />}</Field>
                <Field label="exclude-type（排除协议）">{(id) => <ExcludeTypeSelect id={id} value={eff.excludeType} onChange={(value) => setField('excludeType', value)} />}</Field>
              </div>
              <div className="flex flex-col gap-2">
                {previewNodeSets.length > 1 && <Select aria-label="预览节点集" value={previewNodeSet?.[0] ?? ''} onChange={(e) => setPreviewSelection({ groupId: g.id, key: e.target.value })}>
                  {previewNodeSets.map(([key, ref]) => <option key={key} value={key}>{nodeSetName(ref)}</option>)}
                </Select>}
                {previewNodeSet ? <><span className="text-[12px] text-muted">节点集：{nodeSetName(previewNodeSet[1])}</span><MatchPreview nodeSet={previewNodeSet[1]} filter={eff.filter} excludeFilter={eff.excludeFilter} excludeType={eff.excludeType} /></> : <span className="text-[12px] text-muted">组里没有节点集成员，filter 不生效</span>}
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">hidden（mihomo）{g.origin === 'template' ? ' · 模板设定，只读' : ''}</span>
                  {g.origin === 'template' ? <span className="text-[13px]">{eff.display?.hidden === undefined ? '不设置' : eff.display.hidden ? '开' : '关'}</span> : <OptionalBoolean label="hidden" value={eff.display?.hidden} onChange={(hidden) => setField('display', { ...eff.display, hidden })} />}
                </div>
                <Field label="icon" hint="mihomo icon / Surge icon-url">{(id) => <Input id={id} placeholder="图标地址" value={eff.display?.icon ?? ''} onChange={(e) => setField('display', { ...eff.display, icon: e.target.value || undefined })} />}</Field>
              </div>
              <div className="flex flex-col gap-2">
                <ExtraFields key={g.id} value={Object.fromEntries(Object.entries(eff.extra ?? {}).filter(([key]) => key !== 'empty-fallback'))} validateName={(name) => name === 'empty-fallback' ? '空组固定使用 REJECT，无需配置此字段' : undefined} onChange={(extra) => setField('extra', extra)} />
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
