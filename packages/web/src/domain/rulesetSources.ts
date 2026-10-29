import { api, type RulesetSourceStatus } from '../api.ts';
import type { RuleSetSourceDoc } from '../hooks.ts';

export type RuleSourceContent = { content?: string; status: RulesetSourceStatus };
/** 名称、排序、改写和客户端都不改变来源正文。 */
export function sourceReadInput(s: RuleSetSourceDoc) {
  return { id: s.id, kind: s.kind, format: s.format, url: s.url, content: s.content, repository: s.repository, fetch: s.fetch, behavior: s.behavior };
}
export function rulesetSourceQuery(id: string | undefined, source: RuleSetSourceDoc, refresh = false) {
  const input = sourceReadInput(source);
  return {
    queryKey: ['ruleset-source', id, input] as const,
    staleTime: refresh ? 0 : 60_000,
    retry: false as const,
    queryFn: () => api<RuleSourceContent>('POST', '/rulesets/source', { id, source: input, ...(refresh ? { refresh: true } : {}) }),
  };
}
type SourceResult = { data?: RuleSourceContent; error: Error | null; isPending: boolean; isFetching: boolean };
/** 只检查当前预览范围；HTTP 200 中的业务失败同样阻止新的转换。 */
export function rulesetSourceState(sources: RuleSetSourceDoc[], results: SourceResult[], selected?: string) {
  const required = sources.flatMap((s, i) => (!selected || s.id === selected) ? [i] : []);
  const reading = required.some(i => !results[i] || results[i]!.isPending || results[i]!.isFetching);
  const error = required.map(i => {
    const r = results[i];
    if (r?.error) return r.error;
    if (r?.data && (!r.data.status.ok || (r.data.content === undefined && !r.data.status.passthrough))) {
      return r.data.status.error ?? '来源正文尚未读取成功';
    }
    return undefined;
  }).find(Boolean);
  const ready = !reading && !error && required.every(i => results[i]?.data?.status.ok);
  return { required, reading, ready, error };
}
