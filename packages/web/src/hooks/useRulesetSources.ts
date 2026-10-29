import { useEffect, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useDebouncedValue } from './useDebouncedValue.ts';
import { type RulesetSourceStatus } from '../api.ts';
import type { RuleSetDoc } from '../hooks.ts';

import { rulesetSourceQuery, rulesetSourceState, sourceReadInput } from '../domain/rulesetSources.ts';

export function useRulesetSources(id: string | undefined, draft: RuleSetDoc | undefined, selected?: string) {
  const sources = useDebouncedValue(draft?.sources ?? [], 400);
  const queryClient = useQueryClient();
  const results = useQueries({ queries: sources.map(source => ({
    ...rulesetSourceQuery(id, source),
    enabled: source.enabled !== false || source.id === selected,
  })) });
  const state = rulesetSourceState(sources, results, selected);
  const previous = useRef(new Map<string, RulesetSourceStatus>());
  useEffect(() => {
    for (const [index, s] of sources.entries()) if (results[index]?.data) previous.current.set(s.id, results[index]!.data!.status);
    for (const key of previous.current.keys()) if (!sources.some(s => s.id === key)) previous.current.delete(key);
  }, [sources, results]);
  const statuses = new Map(sources.map((s, i) => [s.id, results[i]!.error ? { id: s.id, ok: false, error: results[i]!.error!.message } : results[i]!.data?.status ?? previous.current.get(s.id)]));
  const loading = new Set(sources.filter((_, i) => results[i]!.isFetching).map(s => s.id));
  // 防抖尚未追上时不要用旧正文配合新设置发送转换请求。
  const current = JSON.stringify(sources.map(s => [sourceReadInput(s), s.enabled])) === JSON.stringify((draft?.sources ?? []).map(s => [sourceReadInput(s), s.enabled]));
  return {
    statuses, loading, ready: !!draft && current && state.ready, reading: !current || state.reading,
    refresh: async () => {
      if (!current || state.reading) return;
      // fetchQuery 把 HTTP 异常写回同一个来源查询，界面显示错误；不制造未处理的拒绝。
      await Promise.allSettled(state.required.map(i => queryClient.fetchQuery(rulesetSourceQuery(id, sources[i]!, true))));
    },
    inputs: (draft?.sources ?? []).map(source => ({
      source: { id: source.id, kind: source.kind, format: source.format, url: source.url, repository: source.repository, fetch: source.fetch, behavior: source.behavior, enabled: source.enabled, overrides: source.overrides },
      content: results[sources.findIndex(s => s.id === source.id)]?.data?.content,
    })),
    error: state.error,
  };
}
