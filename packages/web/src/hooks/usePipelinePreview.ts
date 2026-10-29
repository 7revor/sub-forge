import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Collection, OperatorStep } from '@sub-forge/core';
import { api, type PipelinePreview } from '../api.ts';
import type { SourceDoc } from '../hooks.ts';
import { useDebouncedValue } from './useDebouncedValue.ts';

/**
 * 处理链草稿变化后延迟预览（SRC-06）。组合同时带上成员草稿（COL-02）：
 * 订阅源同时带上基础设置草稿，切换参数后隐藏旧预览，避免把旧地址的节点当作新结果。
 */
export function usePipelinePreview(kind: 'sources' | 'collections', id: string | undefined, steps: OperatorStep[] | undefined, members?: Collection['members'], source?: Pick<SourceDoc, 'url' | 'fetch'>) {
  const draft = useMemo(() => (steps ? { pipeline: steps, ...(members ? { members } : {}), ...(source ? { source } : {}) } : undefined), [steps, members, source]);
  const debounced = useDebouncedValue(draft, 400);
  const query = useQuery({
    queryKey: ['pipeline-preview', kind, id, debounced],
    enabled: !!id && id !== 'new' && !!debounced,
    queryFn: () => api<PipelinePreview>('POST', `/${kind}/${id}/pipeline-preview`, debounced),
    placeholderData: (prev, previous) => JSON.stringify((previous?.queryKey[3] as typeof draft)?.source) === JSON.stringify(source) ? prev : undefined,
    retry: false,
  });
  return { ...query, data: JSON.stringify(source) === JSON.stringify(debounced?.source) ? query.data : undefined, isFetching: query.isFetching || draft !== debounced };
}

