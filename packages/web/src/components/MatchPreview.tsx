import { useModalPresentation } from '../modals/index.tsx';
import type { NodeSetID } from '@sub-forge/core';
import { useNodeList } from '../hooks.ts';
import { filterNodes } from './nodeMatch.ts';

export function MatchPreview({ nodeSet, filter, excludeFilter, excludeType, max = 30 }: {
  nodeSet: NodeSetID | undefined; filter?: string; excludeFilter?: string; excludeType?: string; max?: number;
}) {
  const { data, isLoading, error } = useModalPresentation(useNodeList(nodeSet));
  const result = filterNodes(data?.nodes ?? [], { filter, excludeFilter, excludeType });
  const shown = result.nodes.slice(0, Math.max(0, max));
  return (
    <div className="flex flex-col gap-2 text-xs" aria-live="polite">
      {result.error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{result.error}</div>}
      {!nodeSet?.id && <span className="text-muted-foreground">请选择节点集以预览</span>}
      {isLoading && <span className="text-muted-foreground">节点列表加载中…</span>}
      {error && <span className="text-destructive">节点列表加载失败：{error.message}</span>}
      {data?.report.map((item, i) => <span key={i} className={item.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{item.message}</span>)}
      {data?.truncated && <span className="text-warn">节点列表已截断：当前 {data.nodes.length} / 总数 {data.total}，命中数仅统计当前列表。</span>}
      {data && !error && !result.error && <>
        <span className="text-muted-foreground">{data.truncated ? '当前列表：' : ''}命中 {result.nodes.length} / 总数 {data.total}</span>
        <div className="flex flex-wrap gap-1.5">
          {shown.map((n, i) => <span key={i} title={`${n.type.toUpperCase()} ${n.server}:${n.port}`} className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">{n.name}</span>)}
        </div>
        {shown.length < result.nodes.length && <span className="text-muted-foreground">仅显示前 {shown.length} 个命中节点</span>}
      </>}
    </div>
  );
}
