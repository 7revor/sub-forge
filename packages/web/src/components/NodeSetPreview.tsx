import { useState } from 'react';
import type { NodeSetID } from '@sub-forge/core';
import { useNodeList } from '../hooks.ts';
import { useModalPresentation } from '../modals/index.tsx';
import { filterNodes } from './nodeMatch.ts';
import { Button, Empty } from './ui.tsx';

/** 预览与最终输出共用正则语义；留空包含全部节点，点选只缩小当前草稿范围。 */
export function NodeSetPreview({ nodeSet, filter, excludeFilter, label = '节点', firstMatch = false, onSelect }: {
  nodeSet?: NodeSetID; filter?: string; excludeFilter?: string; label?: string; firstMatch?: boolean; onSelect?: (name: string) => void;
}) {
  const validation = filterNodes([], { filter, excludeFilter });
  const query = useModalPresentation(useNodeList(validation.error ? undefined : nodeSet, '', { filter, excludeFilter }));
  const nodes = query.data?.nodes ?? [];
  const [page, setPage] = useState({ key: '', size: 100 });
  const key = `${nodeSet?.type}:${nodeSet?.id}:${filter ?? ''}:${excludeFilter ?? ''}`;
  const size = page.key === key ? page.size : 100;
  if (!nodeSet?.id) return null;
  return <div className="flex min-w-0 flex-col gap-2 text-[12px]" aria-label={`${label}预览`}>
    {query.isLoading && <p className="m-0 text-ink-muted">正在加载节点…</p>}
    {query.error && <div role="alert" className="text-err">节点加载失败：{query.error.message}<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>重新加载</Button></div>}
    {validation.error && <p role="alert" className="m-0 text-err">{validation.error}</p>}
    {query.data?.report.map((item, i) => <p key={i} className={`m-0 ${item.level === 'error' ? 'text-err' : 'text-ink-muted'}`}>{item.message}</p>)}
    {query.data && !query.error && !validation.error && <>
      <p aria-live="polite" className="m-0 text-ink-muted">{filter || excludeFilter ? '筛选' : '全部'} {query.data.total} / {query.data.unfilteredTotal ?? query.data.total} 个节点</p>
      <div className="max-h-48 overflow-y-auto rounded-md border border-line" aria-label={`${label}列表`}>
        {nodes.slice(0, size).map((node, i) => {
          const content = <><span className="min-w-0 break-all">{node.name}</span><span className="shrink-0 text-[11px] text-ink-muted">{firstMatch && i === 0 ? '当前采用' : node.type.toUpperCase()}</span></>;
          const className = 'flex w-full items-center justify-between gap-3 border-b border-line-2 px-3 py-2.5 text-left text-[13px] last:border-0';
          return onSelect ? <button key={`${i}:${node.name}`} type="button" className={`${className} cursor-pointer hover:bg-ground focus-visible:bg-ground`} title={`仅使用 ${node.name}`} onClick={() => onSelect(node.name)}>{content}</button> : <div key={`${i}:${node.name}`} className={className}>{content}</div>;
        })}
        {!nodes.length && <Empty variant="plain" title="没有匹配节点" />}
        {size < nodes.length && <Button variant="ghost" className="w-full" onClick={() => setPage({ key, size: size + 100 })}>显示更多（剩余 {nodes.length - size} 个）</Button>}
      </div>
      {query.data.truncated && <p className="m-0 text-warn">匹配节点较多，列表仅展示前 {nodes.length} 个；筛选会覆盖全部节点，可继续缩小范围。</p>}
      {firstMatch && <p className="m-0 text-ink-muted">按顺序采用首个匹配节点作为前置；没有匹配时拒绝连接。</p>}
    </>}
  </div>;
}
