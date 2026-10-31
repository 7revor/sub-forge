import type { Builtin, NodeSetID, Target } from '@sub-forge/core';
import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { BUILTINS, targetLabel, type GroupOption } from './pickers.tsx';
import { NodePicker } from './NodePicker.tsx';
import { Button } from './ui.tsx';
import { RoutingTargetMenu } from './RoutingTargetMenu.tsx';
import { Popover, PopoverContent, PopoverAnchor, PopoverTrigger } from './ui/popover.tsx';

/** 常用出口在同一个下拉列表中选择；单节点的高级条件在就地浮层中配置。 */
export function RuleTargetSelect({ value, onChange, groups, nodeSets, label = '规则出口' }: {
  value: Target; onChange: (target: Target) => void; groups: GroupOption[]; nodeSets: { ref: NodeSetID; name: string }[]; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Extract<Target, { kind: 'node' }>>();
  const editNode = () => {
    setDraft(value.kind === 'node' ? structuredClone(value) : { kind: 'node', ref: { nodeSet: { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
    setOpen(true);
  };
  const key = value.kind === 'group' ? (value.groupId ? `group:${value.groupId}` : '') : value.kind === 'builtin' ? `builtin:${value.name}` : 'node';
  const options = [
    ...(value.kind === 'group' && !!value.groupId && !groups.some(group => group.id === value.groupId) ? [{ value: key, label: `已不存在：${value.groupId}` }] : []),
    ...groups.map(group => ({ value: `group:${group.id}`, label: group.name || '未命名组', group: '策略组' })),
    ...BUILTINS.map(name => ({ value: `builtin:${name}`, label: name, group: '内置策略' })),
    { value: 'node', label: value.kind === 'node' ? targetLabel(value, id => id, ref => nodeSets.find(item => item.ref.type === ref.type && item.ref.id === ref.id)?.name ?? ref.id) || '单个节点' : '单个节点' },
  ];
  return <Popover open={open} onOpenChange={next => { if (next) editNode(); else setOpen(false); }}><PopoverAnchor asChild><div className="flex min-w-0 items-center gap-1">
    <RoutingTargetMenu restoreFocus={!open} placeholder="选择策略组、内置策略或节点" label={label} options={options} value={key} onChange={key => {
      if (key.startsWith('group:')) onChange({ kind: 'group', groupId: key.slice(6) });
      else if (key.startsWith('builtin:')) onChange({ kind: 'builtin', name: key.slice(8) as Builtin });
      else editNode();
    }} />
    {value.kind === 'node' && <PopoverTrigger asChild><Button size="sm" variant="ghost" className="shrink-0 px-1.5" aria-label={`配置${label}节点`}><Settings2 size={14} /></Button></PopoverTrigger>}
  </div></PopoverAnchor><PopoverContent align="end" className="w-[min(420px,calc(100vw-2rem))] p-4">
    {draft && <NodePicker label={label} value={draft.ref} onChange={ref => setDraft({ ...draft, ref })} nodeSets={nodeSets} />}
    <div className="mt-4 flex justify-end gap-2 border-t border-line-2 pt-3"><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" disabled={!draft?.ref.nodeSet.id || !('exact' in draft.ref.match ? draft.ref.match.exact : draft.ref.match.regex).trim()} onClick={() => { if (draft) { onChange(structuredClone(draft)); setOpen(false); } }}>确定</Button></div>
  </PopoverContent></Popover>;
}
