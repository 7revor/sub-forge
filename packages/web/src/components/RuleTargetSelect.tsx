import type { Builtin, NodeSetID, Target } from '@sub-forge/core';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { Fragment } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { nodeListOptions } from '../hooks.ts';
import { BUILTINS, targetLabel, type GroupOption } from './pickers.tsx';
import { RoutingTargetMenu } from './RoutingTargetMenu.tsx';
import { DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator } from './ui/dropdown-menu.tsx';

type InlineNodeSet = { ref: NodeSetID; name: string };

export const nodeExitValue = (ref: NodeSetID, name: string) => `node:${JSON.stringify([ref.type, ref.id, name])}`;

/** 菜单选中节点时生成精确引用；节点消失时按拒绝处理，不静默直连。 */
export function nodeExitFromValue(value: string): Extract<Target, { kind: 'node' }> {
  const [type, id, exact] = JSON.parse(value.slice(5)) as [NodeSetID['type'], string, string];
  return { kind: 'node', ref: { nodeSet: { type, id }, match: { exact }, fallback: { kind: 'builtin', name: 'REJECT' } } };
}

/** 单个节点按来源直接列在菜单内；菜单打开后才加载，搜索交给服务端以覆盖截断之外的节点。 */
function InlineNodeOptions({ nodeSets, search }: { nodeSets: InlineNodeSet[]; search: string }) {
  const query = useDebouncedValue(search, 200);
  const results = useQueries({ queries: nodeSets.map(set => ({ ...nodeListOptions(set.ref, query), placeholderData: keepPreviousData })) });
  const note = (text: string, tone = 'text-muted-foreground') => <p className={`px-2 py-1.5 text-xs ${tone}`}>{text}</p>;
  return <>
    <DropdownMenuSeparator />
    {!nodeSets.length && <><DropdownMenuLabel className="text-xs text-muted-foreground">单个节点</DropdownMenuLabel>{note('本订阅没有「展开」的节点来源，引用来源的节点不能直接作为规则出口')}</>}
    {nodeSets.map((set, i) => {
      const { data, isLoading, error } = results[i]!;
      return <Fragment key={`${set.ref.type}:${set.ref.id}`}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">单个节点 · {set.name}</DropdownMenuLabel>
        {isLoading && note('节点列表加载中…')}
        {error && note(`节点列表加载失败：${error.message}`, 'text-destructive')}
        {data && !data.nodes.length && note(search ? '没有匹配的节点' : '节点来源中没有节点')}
        {data?.nodes.map(node => {
          const key = nodeExitValue(set.ref, node.name);
          return <DropdownMenuRadioItem key={key} value={key} textValue={node.name} className="text-sm">
            <span className="min-w-0 flex-1 break-words">{node.name}</span>
          </DropdownMenuRadioItem>;
        })}
        {data?.truncated && note(`仅显示前 ${data.nodes.length} / ${data.total} 个节点，请搜索缩小范围`, 'text-warn')}
      </Fragment>;
    })}
  </>;
}

/** 策略组、内置策略和 inline 节点在同一个菜单中选择；Provider 节点不能作为规则出口。 */
export function RuleTargetSelect({ value, onChange, groups, nodeSets, label = '规则出口', field, id }: {
  value: Target; onChange: (target: Target) => void; groups: GroupOption[]; nodeSets: InlineNodeSet[]; label?: string; field?: boolean; id?: string;
}) {
  const inlineExit = value.kind === 'node' && nodeSets.some(set => set.ref.type === value.ref.nodeSet.type && set.ref.id === value.ref.nodeSet.id);
  const key = value.kind === 'group' ? (value.groupId ? `group:${value.groupId}` : '') : value.kind === 'builtin' ? `builtin:${value.name}` : inlineExit && 'exact' in value.ref.match ? nodeExitValue(value.ref.nodeSet, value.ref.match.exact) : '';
  const selectedLabel = value.kind !== 'node' ? undefined : !inlineExit ? `已失效：${targetLabel(value, id => id, ref => ref.id)}` : 'exact' in value.ref.match ? value.ref.match.exact : `/${value.ref.match.regex}/`;
  const options = [
    ...(value.kind === 'group' && !!value.groupId && !groups.some(group => group.id === value.groupId) ? [{ value: key, label: `已不存在：${value.groupId}` }] : []),
    ...groups.map(group => ({ value: `group:${group.id}`, label: group.name || '未命名组', group: '策略组' })),
    ...BUILTINS.map(name => ({ value: `builtin:${name}`, label: name, group: '内置策略' })),
  ];
  return <RoutingTargetMenu field={field} id={id} placeholder="选择策略组、内置策略或展开来源的节点" label={label} searchLabel="策略组或节点" options={options} value={key} selectedLabel={selectedLabel}
    extra={search => <InlineNodeOptions nodeSets={nodeSets} search={search} />}
    onChange={next => {
      if (next.startsWith('group:')) onChange({ kind: 'group', groupId: next.slice(6) });
      else if (next.startsWith('builtin:')) onChange({ kind: 'builtin', name: next.slice(8) as Builtin });
      else onChange(nodeExitFromValue(next));
    }} />;
}
