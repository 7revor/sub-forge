import type { Builtin, NodeSetID, Target } from '@sub-forge/core';
import { Settings2 } from 'lucide-react';
import { BUILTINS, targetLabel, type GroupOption } from './pickers.tsx';
import { NodePicker } from './NodePicker.tsx';
import { Button, Select } from './ui.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';

/** 常用出口在同一个下拉列表中选择；单节点的高级条件在就地浮层中配置。 */
export function RuleTargetSelect({ value, onChange, groups, nodeSets, label = '规则出口' }: {
  value: Target; onChange: (target: Target) => void; groups: GroupOption[]; nodeSets: { ref: NodeSetID; name: string }[]; label?: string;
}) {
  const key = value.kind === 'group' ? (value.groupId ? `group:${value.groupId}` : '') : value.kind === 'builtin' ? `builtin:${value.name}` : 'node';
  return <div className="flex min-w-0 items-center gap-1">
    <Select placeholder="选择规则命中后使用的策略组、内置策略或节点" aria-label={label} className="min-w-0 flex-1" value={key} onChange={event => {
      const key = event.target.value;
      if (key.startsWith('group:')) onChange({ kind: 'group', groupId: key.slice(6) });
      else if (key.startsWith('builtin:')) onChange({ kind: 'builtin', name: key.slice(8) as Builtin });
      else if (value.kind !== 'node') onChange({ kind: 'node', ref: { nodeSet: nodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
    }}>
      {value.kind === 'group' && !!value.groupId && !groups.some(group => group.id === value.groupId) && <option value={key}>已不存在：{value.groupId}</option>}
      <optgroup label="策略组">{groups.map(group => <option key={group.id} value={`group:${group.id}`}>{group.name || '未命名组'}</option>)}</optgroup>
      <optgroup label="内置策略">{BUILTINS.map(name => <option key={name} value={`builtin:${name}`}>{name}</option>)}</optgroup>
      <option value="node">{value.kind === 'node' ? targetLabel(value, id => id, ref => nodeSets.find(item => item.ref.type === ref.type && item.ref.id === ref.id)?.name ?? ref.id) || '单个节点' : '单个节点'}</option>
    </Select>
    {value.kind === 'node' && <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" className="shrink-0 px-1.5" aria-label={`配置${label}节点`}><Settings2 size={14} /></Button></PopoverTrigger><PopoverContent align="end" className="w-[min(520px,calc(100vw-2rem))]">
      <NodePicker label={label} value={value.ref} onChange={ref => onChange({ ...value, ref })} nodeSets={nodeSets} />
    </PopoverContent></Popover>}
  </div>;
}
