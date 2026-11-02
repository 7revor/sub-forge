import { useLocation } from 'react-router';
import type { Matcher } from '@sub-forge/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { notifySuccess } from '../feedback.ts';

export type RepositoryUrlMatch = { repo: string; entry: string; ref: string; path: string; label: string; hint: string };
export type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;

const LINK_CONCURRENCY = 4;

export async function matchRepositoryUrls(urls: string[]) {
  const unique = [...new Set(urls)];
  const pages = await Promise.all(Array.from({ length: Math.ceil(unique.length / 1000) }, (_, i) =>
    api<{ matches: Record<string, RepositoryUrlMatch[]> }>('POST', '/rule-options/match-urls', { urls: unique.slice(i * 1000, (i + 1) * 1000) })));
  return Object.assign({}, ...pages.map(page => page.matches)) as Record<string, RepositoryUrlMatch[]>;
}

/** 只响应添加、导入和手动检测；不订阅 URL 变化，不使用跨页面查询缓存。 */
export function useRepositoryUrlMatches() {
  const { pathname } = useLocation();
  const [matches, setMatches] = useState<Record<string, RepositoryUrlMatch[]>>({});
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(0);
  const [isLinkingAll, setLinkingAll] = useState(false);
  const session = useRef(0);
  const revisions = useRef(new Map<string, number>());
  useEffect(() => {
    session.current++; revisions.current.clear(); setMatches({}); setError(undefined); setPending(0); setLinkingAll(false);
    return () => { session.current++; };
  }, [pathname]);
  const clear = useCallback((urls: string[]) => {
    for (const url of urls) revisions.current.set(url, (revisions.current.get(url) ?? 0) + 1);
    setMatches(previous => Object.fromEntries(Object.entries(previous).filter(([url]) => !urls.includes(url))));
  }, []);
  const detect = useCallback(async (urls: string[]) => {
    const unique = [...new Set(urls)];
    if (!unique.length) return;
    const epoch = session.current;
    const revision = new Map(unique.map(url => [url, (revisions.current.get(url) ?? 0) + 1]));
    revision.forEach((version, url) => revisions.current.set(url, version));
    setPending(n => n + 1); setError(undefined);
    try {
      const result = await matchRepositoryUrls(unique);
      if (session.current === epoch) setMatches(previous => ({ ...previous, ...Object.fromEntries(unique
        .filter(url => revisions.current.get(url) === revision.get(url)).map(url => [url, result[url] ?? []])) }));
    } catch (cause) { if (session.current === epoch) setError(cause); }
    finally { if (session.current === epoch) setPending(n => n - 1); }
  }, []);
  /** urls 按列表项传入，同一地址多次出现时都计入；apply 基于最新草稿替换并返回实际关联的项数。 */
  const linkAll = async (urls: string[], apply: (resolved: Map<string, RuleSetMatcher>) => number) => {
    const epoch = session.current;
    setLinkingAll(true); setError(undefined);
    try {
      const { resolved, failures } = await resolveRepositoryUrlMatches(uniqueRepositoryMatches(urls, matches));
      if (session.current !== epoch) return;
      const linked = resolved.size ? apply(resolved) : 0;
      clear([...resolved.keys()]);
      const ambiguous = urls.filter(url => (matches[url]?.length ?? 0) > 1).length;
      if (linked) notifySuccess(`已关联 ${linked} 项${ambiguous ? `，${ambiguous} 项有多个候选，请单独选择` : ''}`);
      if (failures.length) setError(new Error(`${failures.length} 个地址关联失败：${failures[0]}`));
    } finally { if (session.current === epoch) setLinkingAll(false); }
  };
  return { matches, error, isPending: pending > 0, isLinkingAll, detect, clear, linkAll };
}

/** 点击候选后重验当前索引；仅展示建议不会修改原 URL 或关联身份。 */
export async function resolveRepositoryUrlMatch(url: string, match: RepositoryUrlMatch): Promise<RuleSetMatcher> {
  const { matcher } = await api<{ matcher: RuleSetMatcher }>('POST', '/rule-options/resolve', {
    source: 'repository', repo: match.repo, entry: match.entry, file: { ref: match.ref, path: match.path },
  });
  if (matcher.repository?.sources.length !== 1 || matcher.repository.sources[0]?.url !== url) throw new Error('仓库文件地址已变化，请重新匹配');
  return matcher;
}

/** 一键关联只处理唯一候选；多候选保留标记，由用户逐项选择。 */
export function uniqueRepositoryMatches(urls: string[], matches: Record<string, RepositoryUrlMatch[]>) {
  return Object.fromEntries(urls.flatMap(url => matches[url]?.length === 1 ? [[url, matches[url][0]!]] : [])) as Record<string, RepositoryUrlMatch>;
}

/** 解析会读取文件正文，因此限制并发；单项失败不影响其余项。 */
export async function resolveRepositoryUrlMatches(matches: Record<string, RepositoryUrlMatch>, resolve = resolveRepositoryUrlMatch) {
  const queue = Object.entries(matches);
  const resolved = new Map<string, RuleSetMatcher>();
  const failures: string[] = [];
  await Promise.all(Array.from({ length: Math.min(LINK_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try { resolved.set(next[0], await resolve(next[0], next[1])); }
      catch (cause) { failures.push(cause instanceof Error ? cause.message : String(cause)); }
    }
  }));
  return { resolved, failures };
}
