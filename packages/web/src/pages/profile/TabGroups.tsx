// 策略组：填充模板组（只能加成员、调整类型与测速参数，不能删除、改名或隐藏，PRF-09），管理私有组。

import type { Builtin, GroupMember, GroupSpec, GroupType, NodeSetID } from '@sub-forge/core';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BUILTINS, NodeSetSelect, TargetPicker, memberLabel } from '../../components/pickers.tsx';
import { Badge, Button, Card, Empty, Field, Input, Select, cx } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

const TYPES: GroupType[] = ['select', 'url-test', 'fallback', 'load-balance'];
type Editable = Pick<GroupSpec, 'type' | 'filter' | 'excludeFilter' | 'excludeType' | 'test' | 'strategy'>;

function MemberAdder({ onAdd, excludeGroupId }: { onAdd: (m: GroupMember) => void; excludeGroupId: string }) {
  const { profileNodeSets, groupOptions } = useProfile();
  const [kind, setKind] = useState<GroupMember['kind']>('nodeset');
  const [ns, setNs] = useState<NodeSetID | undefined>(profileNodeSets[0]?.ref);
  const [groupId, setGroupId] = useState('');
  const [builtin, setBuiltin] = useState<Builtin>('DIRECT');
  const [node, setNode] = useState<{ kind: 'node'; ref: import('@sub-forge/core').NodeRef }>({ kind: 'node', ref: { nodeSet: profileNodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
  const groups = groupOptions.filter((g) => g.id !== excludeGroupId);

  const add = () => {
    if (kind === 'nodeset' && ns) onAdd({ kind: 'nodeset', ref: ns });
    else if (kind === 'group' && (groupId || groups[0])) onAdd({ kind: 'group', groupId: groupId || groups[0]!.id });
    else if (kind === 'builtin') onAdd({ kind: 'builtin', name: builtin });
    else if (kind === 'node' && 'exact' in node.ref.match && node.ref.match.exact) onAdd({ kind: 'node', ref: node.ref });
    else if (kind === 'all') onAdd({ kind: 'all', scope: 'providers' });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-ground p-2.5">
      <Select aria-label="成员类型" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value as GroupMember['kind'])}>
        <option value="nodeset">节点集</option>
        <option value="group">其他组</option>
        <option value="builtin">内置策略</option>
        <option value="node">单个节点</option>
        <option value="all">全部 provider</option>
      </Select>
      {kind === 'nodeset' && <div className="min-w-48"><NodeSetSelect label="节点集" value={ns} options={profileNodeSets} onChange={setNs} placeholder={profileNodeSets.length ? '选择节点集' : '先在「节点集」中加入'} /></div>}
      {kind === 'group' && <Select aria-label="组" className="w-auto min-w-40" value={groupId || groups[0]?.id || ''} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}
      {kind === 'builtin' && <Select aria-label="内置策略" className="w-auto" value={builtin} onChange={(e) => setBuiltin(e.target.value as Builtin)}>{BUILTINS.map((b) => <option key={b}>{b}</option>)}</Select>}
      {kind === 'node' && <TargetPicker label="节点" allowNode value={node} groups={[]} nodeSets={profileNodeSets} onChange={(t) => { if (t.kind === 'node') setNode(t); }} />}
      <Button size="sm" onClick={add}><Plus size={14} />添加成员</Button>
    </div>
  );
}

export function TabGroups() {
  const { draft, groups, template, patchOverlay, groupName, nodeSetName } = useProfile();
  const [selectedId, setSelectedId] = useState<string | undefined>(groups[0]?.id);
  const g = groups.find((x) => x.id === selectedId) ?? groups[0];
  const patch = g && g.origin === 'template' ? draft.overlay.groupPatches?.[g.id] ?? {} : {};
  const eff: (GroupSpec & { origin: string }) | undefined = g && (g.origin === 'template' ? { ...g, ...(patch.set ?? {}), members: g.members } : g);
  const added: GroupMember[] = g ? (g.origin === 'template' ? patch.addMembers ?? [] : g.members) : [];
  const orphans = Object.keys(draft.overlay.groupPatches ?? {}).filter((id) => !template?.groups.some((t) => t.id === id));

  const setField = <K extends keyof Editable>(k: K, v: Editable[K] | undefined) => {
    if (!g) return;
    if (g.origin === 'template') {
      patchOverlay((o) => {
        const p = o.groupPatches?.[g.id] ?? {};
        const set = { ...(p.set ?? {}) } as Record<string, unknown>;
        if (v === undefined || v === '') delete set[k]; else set[k] = v;
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
  const removePrivate = () => {
    if (!g || g.origin !== 'profile') return;
    patchOverlay((o) => ({ ...o, extraGroups: (o.extraGroups ?? []).filter((e) => e.group.id !== g.id) }));
    setSelectedId(groups[0]?.id);
  };
  const test = eff?.test ?? {};
  const totalMembers = (x: typeof groups[number]) => x.origin === 'template' ? x.members.length + (draft.overlay.groupPatches?.[x.id]?.addMembers?.length ?? 0) : x.members.length;

  return (
    <>
      {orphans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-4 py-3 text-[#6b3406]">
          <span className="text-[13px]"><b>{orphans.length} 个孤儿覆盖项不再输出：</b>模板已删除这些组（{orphans.join('、')}），对它们的填充已失效。</span>
          <Button size="sm" onClick={() => patchOverlay((o) => ({ ...o, groupPatches: Object.fromEntries(Object.entries(o.groupPatches ?? {}).filter(([id]) => !orphans.includes(id))) }))}>清理</Button>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-5">
        <Card title="策略组" actions={<span className="text-[12px] text-muted">顺序即面板顺序</span>} className="min-w-0 flex-[1_1_300px]" bodyClass="pb-2">
          <ul className="-mx-4 m-0 list-none p-0">
            {groups.map((x) => {
              const n = totalMembers(x);
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => setSelectedId(x.id)} className={cx('flex w-full cursor-pointer items-center gap-2.5 border-t border-line-2 px-4 py-2.5 text-left', x.id === g?.id ? 'bg-accent-soft' : 'bg-panel hover:bg-ground')}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13.5px] font-medium">{x.name}</span>
                      <span className="text-[12px] text-muted">{x.type} · {x.origin === 'template' ? '模板组' : '私有组'}</span>
                    </span>
                    {n === 0 ? <Badge tone="warn">空 · {x.whenEmpty === 'direct' ? '直连' : '拒绝'}</Badge> : <span className="font-mono text-[12px] text-ink-2">{n} 成员</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {!groups.length && <Empty>没有组。选择模板或新增私有组。</Empty>}
          <div className="-mx-4 border-t border-line-2 px-4 pt-2.5"><Button className="w-full border-dashed" onClick={addPrivate}><Plus size={15} />新增私有组</Button></div>
        </Card>

        {g && eff && (
          <Card className="min-w-0 flex-[999_1_560px]"
            title={<div className="flex flex-col gap-1">
              <h2 className="m-0 text-lg font-semibold">{g.origin === 'template' ? g.name : <Input aria-label="组名" value={g.name} onChange={(e) => patchOverlay((o) => ({ ...o, extraGroups: (o.extraGroups ?? []).map((x) => (x.group.id === g.id ? { ...x, group: { ...x.group, name: e.target.value } } : x)) }))} />}</h2>
              <span className="text-[12.5px] text-muted">{g.origin === 'template' ? '模板组 · 可填充成员、调整类型与测速参数；不能删除、改名或隐藏' : '私有组 · 只属于这个配置订阅'}</span>
            </div>}
            actions={g.origin === 'template' ? (g.hint ? <Badge>模板提示：{g.hint}</Badge> : undefined) : <Button variant="danger" size="sm" onClick={removePrivate}><Trash2 size={14} />删除组</Button>}>
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                <Field label="类型">{(id) => <Select id={id} value={eff.type} onChange={(e) => setField('type', e.target.value as GroupType)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
                {eff.type !== 'select' && <>
                  <Field label="测速地址">{(id) => <Input id={id} className="font-mono" placeholder="默认" value={test.url ?? ''} onChange={(e) => setField('test', { ...test, url: e.target.value || undefined })} />}</Field>
                  <Field label="间隔（秒）">{(id) => <Input id={id} type="number" value={test.interval ?? ''} onChange={(e) => setField('test', { ...test, interval: e.target.value ? Number(e.target.value) : undefined })} />}</Field>
                  {eff.type === 'url-test' && <Field label="容差（ms）">{(id) => <Input id={id} type="number" value={test.tolerance ?? ''} onChange={(e) => setField('test', { ...test, tolerance: e.target.value ? Number(e.target.value) : undefined })} />}</Field>}
                </>}
                {eff.type === 'load-balance' && <Field label="策略">{(id) => <Select id={id} value={eff.strategy ?? 'consistent-hashing'} onChange={(e) => setField('strategy', e.target.value as GroupSpec['strategy'])}><option>consistent-hashing</option><option>round-robin</option><option>sticky-sessions</option></Select>}</Field>}
                <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">为空时{g.origin === 'template' ? '（模板设定）' : ''}</span><span className="flex h-[38px] items-center text-[13px]">{eff.whenEmpty === 'direct' ? '直连 · 输出 COMPATIBLE' : '拒绝 · 输出 REJECT'}</span></div>
              </div>

              <div className="flex flex-col gap-2.5">
                <span className="text-[14px] font-semibold">成员</span>
                <ul className="m-0 flex list-none flex-col rounded-lg border border-line p-0">
                  {g.origin === 'template' && g.members.map((m, i) => {
                    const l = memberLabel(m, groupName, nodeSetName);
                    return <li key={`t${i}`} className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-2.5 last:border-0"><Badge>{l.kind}</Badge><span className="text-[13.5px]">{l.text}</span><span className="ml-auto flex items-center gap-1 text-[12px] text-muted"><Lock size={12} />来自模板</span></li>;
                  })}
                  {added.map((m, i) => {
                    const l = memberLabel(m, groupName, nodeSetName);
                    return (
                      <li key={`a${i}`} className="flex items-center gap-2.5 border-b border-line-2 px-3.5 py-2.5 last:border-0">
                        <Badge tone="accent">{l.kind}</Badge><span className="text-[13.5px] font-medium">{l.text}</span>
                        <Button size="sm" variant="ghost" className="ml-auto" aria-label={`移除 ${l.text}`} onClick={() => setMembers(added.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
                      </li>
                    );
                  })}
                  {!g.members.length && !added.length && <li className="px-3.5 py-3 text-[13px] text-muted">没有成员，按"为空时"的设定输出。</li>}
                </ul>
                <MemberAdder key={g.id} excludeGroupId={g.id} onAdd={(m) => setMembers([...added, m])} />
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                <Field label="filter（保留）" hint="作用于节点集成员；内联节点集由服务端预过滤">{(id) => <Input id={id} className="font-mono" value={eff.filter ?? ''} onChange={(e) => setField('filter', e.target.value)} />}</Field>
                <Field label="exclude-filter（剔除）">{(id) => <Input id={id} className="font-mono" value={eff.excludeFilter ?? ''} onChange={(e) => setField('excludeFilter', e.target.value)} />}</Field>
                <Field label="exclude-type">{(id) => <Input id={id} className="font-mono" placeholder="如 ss|http" value={eff.excludeType ?? ''} onChange={(e) => setField('excludeType', e.target.value)} />}</Field>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
