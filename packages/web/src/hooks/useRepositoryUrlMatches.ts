import { useQuery } from '@tanstack/react-query';
import type { Matcher } from '@sub-forge/core';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export type RepositoryUrlMatch = { repo: string; entry: string; ref: string; path: string; label: string; hint: string };
type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;

export function useRepositoryUrlMatches(urls: string[]) {
  const key = JSON.stringify([...new Set(urls)].sort());
  const [debounced, setDebounced] = useState('[]');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(key), 300);
    return () => clearTimeout(timer);
  }, [key]);
  const query = useQuery({
    queryKey: ['rule-options', 'match-urls', debounced],
    enabled: debounced !== '[]' && debounced === key,
    queryFn: async () => {
      const urls = JSON.parse(debounced) as string[];
      const pages = await Promise.all(Array.from({ length: Math.ceil(urls.length / 1000) }, (_, i) =>
        api<{ matches: Record<string, RepositoryUrlMatch[]> }>('POST', '/rule-options/match-urls', { urls: urls.slice(i * 1000, (i + 1) * 1000) })));
      return { matches: Object.assign({}, ...pages.map(page => page.matches)) as Record<string, RepositoryUrlMatch[]> };
    },
    staleTime: 0,
  });
  return { ...query, matches: debounced === key ? query.data?.matches ?? {} : {} };
}

/** 点击候选后再解析当前索引，避免保存已经变动或扩展为多文件的映射。 */
export async function resolveRepositoryUrlMatch(url: string, match: RepositoryUrlMatch): Promise<RuleSetMatcher> {
  const { matcher } = await api<{ matcher: RuleSetMatcher }>('POST', '/rule-options/resolve', {
    source: 'repository', repo: match.repo, entry: match.entry, file: { ref: match.ref, path: match.path },
  });
  if (matcher.repository?.sources.length !== 1 || matcher.repository.sources[0]?.url !== url) throw new Error('仓库文件地址已变化，请重新匹配');
  return matcher;
}
