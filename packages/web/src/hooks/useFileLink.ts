import { useQuery } from '@tanstack/react-query';
import { queryUrl, stableHash, stableStringify, type Matcher } from '@sub-forge/core';
import { api } from '../api.ts';

export type RuleFileContext = { kind: 'templates' | 'profiles'; id: string };
export function useFileToken() {
  const query = useQuery({ queryKey: ['user-token'], queryFn: () => api<{ item: { token: string } }>('GET', '/me/token').then(result => result.item.token) });
  return query.error || query.isFetching ? undefined : query.data;
}
export function ruleFileHref(token: string | undefined, context: RuleFileContext | undefined, ruleId: string, matcher: Matcher): string | undefined {
  if (matcher.kind !== 'ruleset') return undefined;
  if (matcher.repository) {
    if (!token) return undefined;
    const files = matcher.repository.sources.map(source => ({ ref: source.repository!.ref, path: source.repository!.path }));
    return files.length === 1 ? repositoryFileHref(token, { repo: matcher.repository.repo, ...files[0]! })
      : queryUrl('/resources/repo', { id: matcher.repository.repo, files: JSON.stringify(files), token });
  }
  if (!matcher.remote) return token ? queryUrl('/resources/ruleset', { id: matcher.id, view: 'source', token }) : undefined;
  if (!context?.id || context.id === 'new') return undefined;
  const revision = stableHash(stableStringify(matcher));
  if (context.kind === 'templates') return queryUrl('/api/templates/rule-file', { id: context.id, rule: ruleId, revision });
  return token ? queryUrl('/subs/ruleset', { profile: context.id, rule: ruleId, view: 'source', revision, token }) : undefined;
}
export function repositoryFileHref(token: string | undefined, file: { repo: string; ref: string; path: string }): string | undefined {
  return token ? queryUrl('/resources/repo', { id: file.repo, ref: file.ref, path: file.path, token }) : undefined;
}
