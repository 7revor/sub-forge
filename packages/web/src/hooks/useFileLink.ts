import { useQuery } from '@tanstack/react-query';
import { stableHash, stableStringify, type Matcher } from '@sub-forge/core';
import { api } from '../api.ts';

export type RuleFileContext = { kind: 'templates' | 'profiles'; id: string };
export function useFileToken() {
  const query = useQuery({ queryKey: ['user-token'], queryFn: () => api<{ item: { token: string } }>('GET', '/me/token').then(result => result.item.token) });
  return query.error || query.isFetching ? undefined : query.data;
}
export function ruleFileHref(token: string | undefined, context: RuleFileContext | undefined, ruleId: string, matcher: Matcher): string | undefined {
  if (!token || !context?.id || context.id === 'new' || matcher.kind !== 'ruleset') return undefined;
  return `/api/files/${encodeURIComponent(token)}/${context.kind}/${encodeURIComponent(context.id)}/rules/${encodeURIComponent(ruleId)}?revision=${stableHash(stableStringify(matcher))}`;
}
export function repositoryFileHref(token: string | undefined, file: { repo: string; ref: string; path: string }): string | undefined {
  return token ? `/api/files/${encodeURIComponent(token)}/repository?${new URLSearchParams(file)}` : undefined;
}
