// 选择器：节点集、出口（内置策略 / 组 / 单个节点）、组成员。供 Profile、本地节点、组合等页面共用。

import type { Builtin, GroupMember, NodeSetID, Target } from '@sub-forge/core';
import { useList } from '../hooks.ts';
import { Select } from './ui.tsx';
import { NodePicker } from './NodePicker.tsx';

export const BUILTINS: Builtin[] = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'];
const NS_LABEL = { source: '订阅源', collection: '组合', local: '本地节点组' } as const;

/** 当前用户全部节点集（订阅源、组合、本地节点组）的名称表 */
export function useNodeSetNames() {
  const sources = useList('sources').data ?? [];
  const collections = useList('collections').data ?? [];
  const locals = useList('locals').data ?? [];
  const all: { ref: NodeSetID; name: string }[] = [
    ...sources.map((d) => ({ ref: { type: 'source' as const, id: d.id }, name: d.name })),
    ...collections.map((d) => ({ ref: { type: 'collection' as const, id: d.id }, name: d.name })),
    ...locals.map((d) => ({ ref: { type: 'local' as const, id: d.id }, name: d.name })),
  ];
  const nameOf = (ref: NodeSetID) => all.find((x) => x.ref.type === ref.type && x.ref.id === ref.id)?.name ?? `${ref.type}:${ref.id}`;
  return { all, nameOf };
}

const key = (r: NodeSetID) => `${r.type}:${r.id}`;
const parseKey = (k: string): NodeSetID => { const [type, ...rest] = k.split(':'); return { type: type as NodeSetID['type'], id: rest.join(':') }; };

export function NodeSetSelect({ value, onChange, options, label, placeholder = '选择节点集' }: {
  value: NodeSetID | undefined; onChange: (r: NodeSetID) => void; options: { ref: NodeSetID; name: string }[]; label: string; placeholder?: string;
}) {
  return (
    <Select aria-label={label} value={value ? key(value) : ''} onChange={(e) => e.target.value && onChange(parseKey(e.target.value))}>
      <option value="" disabled>{placeholder}</option>
      {options.map((o) => <option key={key(o.ref)} value={key(o.ref)}>{NS_LABEL[o.ref.type]} · {o.name}</option>)}
    </Select>
  );
}

export type GroupOption = { id: string; name: string };

/** 出口 / 前置选择：内置策略、组、或某个节点集里的单个节点（精确名称 / 正则） */
export function TargetPicker({ value, onChange, groups, nodeSets, allowNode = true, allowGroup = true, label, exclude }: {
  value: Target; onChange: (t: Target) => void; groups: GroupOption[]; nodeSets: { ref: NodeSetID; name: string }[]; allowNode?: boolean; allowGroup?: boolean; label: string;
  exclude?: { nodeSet: NodeSetID; names: string[] };
}) {
  const kind = value.kind;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={`${label}类型`} className="w-auto" value={kind} onChange={(e) => {
        const k = e.target.value as Target['kind'];
        if (k === 'builtin') onChange({ kind: 'builtin', name: 'DIRECT' });
        else if (k === 'group') onChange({ kind: 'group', groupId: groups[0]?.id ?? '' });
        else onChange({ kind: 'node', ref: { nodeSet: nodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
      }}>
        <option value="group" disabled={!allowGroup}>策略组</option>
        <option value="builtin">内置策略</option>
        {allowNode && <option value="node">单个节点</option>}
      </Select>
      {value.kind === 'builtin' && (
        <Select aria-label={label} className="w-auto" value={value.name} onChange={(e) => onChange({ kind: 'builtin', name: e.target.value as Builtin })}>
          {BUILTINS.map((b) => <option key={b}>{b}</option>)}
        </Select>
      )}
      {value.kind === 'group' && (
        <Select aria-label={label} className="w-auto min-w-40" disabled={!allowGroup} value={value.groupId} onChange={(e) => onChange({ kind: 'group', groupId: e.target.value })}>
          {!groups.some((g) => g.id === value.groupId) && <option value={value.groupId}>（已不存在：{value.groupId}）</option>}
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      )}
      {value.kind === 'node' && (
        <NodePicker label={label} nodeSets={nodeSets} exclude={exclude} value={value.ref} onChange={(ref) => onChange({ ...value, ref })} />
      )}
    </div>
  );
}

export function targetLabel(t: Target, groupName: (id: string) => string, nodeSetName: (r: NodeSetID) => string): string {
  if (t.kind === 'builtin') return t.name;
  if (t.kind === 'group') return groupName(t.groupId);
  return `${nodeSetName(t.ref.nodeSet)} · ${'exact' in t.ref.match ? t.ref.match.exact : `/${t.ref.match.regex}/`}`;
}

export function memberLabel(m: GroupMember, groupName: (id: string) => string, nodeSetName: (r: NodeSetID) => string): { kind: string; text: string } {
  switch (m.kind) {
    case 'builtin': return { kind: '内置', text: m.name };
    case 'group': return { kind: '组', text: groupName(m.groupId) };
    case 'nodeset': return { kind: '节点集', text: nodeSetName(m.ref) };
    case 'node': return { kind: '节点', text: targetLabel({ kind: 'node', ref: m.ref }, groupName, nodeSetName) };
    case 'all': return { kind: '全部', text: m.scope === 'all' ? '全部节点与组' : m.scope === 'proxies' ? '全部本地节点' : '全部 provider' };
  }
}
