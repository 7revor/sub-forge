import type { Builtin, GroupMember, NodeSetID } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { BUILTINS, NodeSetSelect } from '../../components/pickers.tsx';
import { NodePicker } from '../../components/NodePicker.tsx';
import { Button, Select } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

export function MemberAdder({ onAdd, excludeGroupId }: { onAdd: (m: GroupMember) => void; excludeGroupId: string }) {
  const { profileNodeSets, groupOptions } = useProfile();
  const [kind, setKind] = useState<GroupMember['kind']>('nodeset');
  const [ns, setNs] = useState<NodeSetID | undefined>(profileNodeSets[0]?.ref);
  const [groupId, setGroupId] = useState('');
  const [scope, setScope] = useState<Extract<GroupMember, { kind: 'all' }>['scope']>('all');
  const [builtin, setBuiltin] = useState<Builtin>('DIRECT');
  const [node, setNode] = useState<{ kind: 'node'; ref: import('@sub-forge/core').NodeRef }>({ kind: 'node', ref: { nodeSet: profileNodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
  const groups = groupOptions.filter((g) => g.id !== excludeGroupId);

  const canAdd = kind === 'nodeset' ? !!ns : kind === 'group' ? !!(groupId || groups[0]) : kind === 'node' ? !!node.ref.nodeSet.id && !!('exact' in node.ref.match ? node.ref.match.exact.trim() : node.ref.match.regex.trim()) : true;
  const add = () => {
    if (!canAdd) return;
    if (kind === 'nodeset' && ns) onAdd({ kind: 'nodeset', ref: ns });
    else if (kind === 'group' && (groupId || groups[0])) onAdd({ kind: 'group', groupId: groupId || groups[0]!.id });
    else if (kind === 'builtin') onAdd({ kind: 'builtin', name: builtin });
    else if (kind === 'node' && ('exact' in node.ref.match ? node.ref.match.exact : node.ref.match.regex)) onAdd({ kind: 'node', ref: node.ref });
    else if (kind === 'all') onAdd({ kind: 'all', scope });
  };

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg bg-ground p-2.5">
      <Select aria-label="成员类型" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value as GroupMember['kind'])}>
        <option value="nodeset">节点集</option>
        <option value="group">其他组</option>
        <option value="builtin">内置策略</option>
        <option value="node">单个节点</option>
        <option value="all">全部节点</option>
      </Select>
      {kind === 'nodeset' && <div className="min-w-48"><NodeSetSelect label="节点集" value={ns} options={profileNodeSets} onChange={setNs} placeholder={profileNodeSets.length ? '选择节点集' : '先添加节点来源'} /></div>}
      {kind === 'group' && <Select aria-label="组" className="w-auto min-w-40" value={groupId || groups[0]?.id || ''} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}
      {kind === 'builtin' && <Select aria-label="内置策略" className="w-auto" value={builtin} onChange={(e) => setBuiltin(e.target.value as Builtin)}>{BUILTINS.map((b) => <option key={b}>{b}</option>)}</Select>}
      {kind === 'node' && <NodePicker label="节点" value={node.ref} nodeSets={profileNodeSets} onChange={(ref) => setNode({ kind: 'node', ref })} />}
      {kind === 'all' && <Select aria-label="全部节点范围" className="w-auto" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="all">全部</option><option value="proxies">本地节点</option><option value="providers">Provider</option></Select>}
      <Button size="sm" disabled={!canAdd} onClick={add}><Plus size={14} />添加成员</Button>
    </div>
  );
}

