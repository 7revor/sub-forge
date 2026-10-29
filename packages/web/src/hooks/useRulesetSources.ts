import { useEffect, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useDebouncedValue } from './useDebouncedValue.ts';
import { api, type RulesetSourceStatus } from '../api.ts';
import type { RuleSetDoc, RuleSetSourceDoc } from '../hooks.ts';

export type RuleSourceContent = { content?: string; status: RulesetSourceStatus };
/** 获取键只包含读取与解析所需字段；名称、排序、改写和客户端都不能触发上游读取。 */
export function sourceReadInput(s: RuleSetSourceDoc) {
  return { id: s.id, kind: s.kind, format: s.format, url: s.url, content: s.content, repository: s.repository, fetch: s.fetch, behavior: s.behavior };
}
export function useRulesetSources(id: string | undefined, draft: RuleSetDoc | undefined, selected?: string) {
  const sources = useDebouncedValue(draft?.sources ?? [], 400);
  const results = useQueries({ queries: sources.map(source => ({
    queryKey: ['ruleset-source', id, sourceReadInput(source)],
    enabled: source.enabled !== false || source.id === selected,
    staleTime: 60_000,
    retry: false,
    queryFn: () => api<RuleSourceContent>('POST', '/rulesets/source', { id, source: sourceReadInput(source) }),
  })) });
  const previous = useRef(new Map<string, RulesetSourceStatus>());
  useEffect(() => {
    for (const [index, s] of sources.entries()) if (results[index]?.data) previous.current.set(s.id, results[index]!.data!.status);
    for (const key of previous.current.keys()) if (!sources.some(s => s.id === key)) previous.current.delete(key);
  }, [sources, results]);
  const statuses = new Map(sources.map((s, i) => [s.id, results[i]!.data?.status ?? (results[i]!.error ? { id: s.id, ok: false, error: results[i]!.error!.message } : previous.current.get(s.id))]));
  const loading = new Set(sources.filter((_, i) => results[i]!.isFetching).map(s => s.id));
  const pending = sources.some((s, i) => (s.enabled !== false || s.id === selected) && results[i]!.isPending);
  // 防抖尚未追上时不要用旧正文配合新设置发送转换请求。
  const current = JSON.stringify(sources.map(sourceReadInput)) === JSON.stringify((draft?.sources ?? []).map(sourceReadInput));
  return {
    statuses, loading, ready: !!draft && current && !pending,
    inputs: (draft?.sources ?? []).map(source => ({
      source: { id: source.id, kind: source.kind, format: source.format, url: source.url, repository: source.repository, fetch: source.fetch, behavior: source.behavior, enabled: source.enabled, overrides: source.overrides },
      content: results[sources.findIndex(s => s.id === source.id)]?.data?.content,
    })),
    error: results.find(r => r.error)?.error ?? results.find(r => r.data?.status.error)?.data?.status.error,
  };
}
