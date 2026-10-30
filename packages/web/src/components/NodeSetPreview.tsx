import { useState } from 'react';
import type { NodeRef, NodeSetID } from '@sub-forge/core';
import { useQueries } from '@tanstack/react-query';
import { nodeListOptions } from '../hooks.ts';
import { useModalPresentation } from '../modals/index.tsx';
import { filterNodes, resolveRef } from './nodeMatch.ts';
import { Button, Empty } from './ui.tsx';

/** 预览与最终输出共用正则语义；留空包含全部节点，点选只缩小当前草稿范围。 */
export function NodeSetPreview({ nodeSet, nodeSets, filter, excludeFilter, label = '节点', firstMatch = false, selection, onSelect }: {
  nodeSet?: NodeSetID; nodeSets?: { ref: NodeSetID; name: string }[]; filter?: string; excludeFilter?: string; label?: string; firstMatch?: boolean;
  /** 仅标记当前采用范围，不裁剪点选列表。 */
  selection?: { match: NodeRef['match'] } | { filter?: string; excludeFilter?: string };
  onSelect?: (name: string, nodeSet: NodeSetID) => void;
}) {
  const validation = filterNodes([], { filter, excludeFilter });
  const sources = nodeSets ?? (nodeSet?.id ? [{ ref: nodeSet, name: '' }] : []);
  const queries = useQueries({ queries: sources.map(source => ({ ...nodeListOptions(source.ref, '', { filter, excludeFilter }), enabled: !validation.error })) });
  const query = useModalPresentation({
    isLoading: queries.some(query => query.isLoading),
    error: queries.find(query => query.error)?.error,
    refetch: () => Promise.all(queries.map(query => query.refetch())),
    data: queries.length && queries.every(query => query.data) ? {
      nodes: queries.flatMap((query, i) => query.data!.nodes.map(node => ({ ...node, nodeSet: sources[i]!.ref, sourceName: sources[i]!.name }))),
      total: queries.reduce((total, query) => total + query.data!.total, 0),
      unfilteredTotal: queries.reduce((total, query) => total + (query.data!.unfilteredTotal ?? query.data!.total), 0),
      truncated: queries.some(query => query.data!.truncated),
      report: queries.flatMap(query => query.data!.report),
    } : undefined,
  });
  const nodes = query.data?.nodes ?? [];
  const resolved = selection && 'match' in selection ? resolveRef(nodes, selection.match) : undefined;
  const selected = selection && !('match' in selection) ? filterNodes(nodes, selection) : undefined;
  const selectedNodes = new Set(resolved?.node ? [resolved.node] : selected?.nodes ?? []);
  const selectionError = resolved?.error ?? selected?.error;
  const [page, setPage] = useState({ key: '', size: 100 });
  const key = JSON.stringify([sources.map(source => source.ref), filter, excludeFilter]);
  const size = page.key === key ? page.size : 100;
  if (!sources.length) return <Empty variant="plain" title="当前类型没有节点来源" />;
  return <div className="flex min-w-0 flex-col gap-2 text-[12px]" aria-label={`${label}预览`}>
    {query.isLoading && <p className="m-0 text-ink-muted">正在加载节点…</p>}
    {query.error && <div role="alert" className="text-err">节点加载失败：{query.error.message}<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>重新加载</Button></div>}
    {validation.error && <p role="alert" className="m-0 text-err">{validation.error}</p>}
    {selectionError && <p role="alert" className="m-0 text-err">{selectionError}</p>}
    {query.data?.report.map((item, i) => <p key={i} className={`m-0 ${item.level === 'error' ? 'text-err' : 'text-ink-muted'}`}>{item.message}</p>)}
    {query.data && !query.error && !validation.error && <>
      <p aria-live="polite" className="m-0 text-ink-muted">{filter || excludeFilter ? '筛选' : '全部'} {query.data.total} / {query.data.unfilteredTotal ?? query.data.total} 个节点</p>
      <div className="max-h-48 overflow-y-auto rounded-md border border-line" aria-label={`${label}列表`}>
        {nodes.slice(0, size).map((node, i) => {
          const active = selection ? selectedNodes.has(node) : firstMatch && i === 0;
          const content = <>
            <span className="min-w-0 break-all">{node.name}{sources.length > 1 && <span className="ml-2 text-[11px] text-ink-muted">{node.sourceName}</span>}</span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-muted">
              {active && <span>{firstMatch ? '当前采用' : '已选'}</span>}
              <span>{node.type.toUpperCase()}</span>
            </span>
          </>;
          const className = 'flex w-full items-center justify-between gap-3 border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-0';
          return onSelect ? <button key={`${i}:${node.name}`} type="button" aria-pressed={selection ? active : undefined} className={`${className} cursor-pointer hover:bg-ground focus-visible:bg-ground ${selection && active ? 'bg-ground font-medium' : ''}`} title={`仅使用 ${node.name}`} onClick={() => onSelect(node.name, node.nodeSet)}>{content}</button> : <div key={`${i}:${node.name}`} className={className}>{content}</div>;
        })}
        {!nodes.length && <Empty variant="plain" title="没有匹配节点" />}
        {size < nodes.length && <Button variant="ghost" className="w-full" onClick={() => setPage({ key, size: size + 100 })}>显示更多（剩余 {nodes.length - size} 个）</Button>}
      </div>
      {query.data.truncated && <p className="m-0 text-warn">节点较多，每个来源最多预览 5000 个节点，列表按批次展示。</p>}
      {selection && !selectionError && !selectedNodes.size && !query.data.truncated && <p role="status" className="m-0 text-warn">当前设置没有匹配节点，请重新点选。</p>}
      {firstMatch && !selection && <p className="m-0 text-ink-muted">按顺序采用首个匹配节点作为前置；没有匹配时拒绝连接。</p>}
    </>}
  </div>;
}
