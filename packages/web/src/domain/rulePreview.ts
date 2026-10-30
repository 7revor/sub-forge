import type { Matcher, RuleSetSource } from '@sub-forge/core';

export type RulePreviewLink = { href: string; label?: string; title?: string };

/** 源文件预览不依赖保存状态、账户令牌或客户端转换。 */
export function sourcePreviewHref(source: Pick<RuleSetSource, 'kind' | 'url'>): string | undefined {
  if (source.kind !== 'remote' || !source.url) return undefined;
  try {
    const url = new URL(source.url);
    return ['https:', 'http:'].includes(url.protocol) ? source.url : undefined;
  } catch { return undefined; }
}

export function rulePreviewLinks(matcher: Matcher): RulePreviewLink[] {
  if (matcher.kind !== 'ruleset') return [];
  if (matcher.repository) return matcher.repository.sources.flatMap(source => {
    const href = source.enabled !== false && sourcePreviewHref(source);
    return href ? [{ href, label: source.name ?? source.repository?.path ?? href }] : [];
  });
  if (matcher.remote) {
    const href = sourcePreviewHref({ kind: 'remote', url: matcher.remote.url });
    return href ? [{ href }] : [];
  }
  // 增强集合的合并、去重和客户端改写统一由详情页预览，不能拼接原文冒充结果。
  return matcher.id ? [{ href: `/rulesets/${encodeURIComponent(matcher.id)}#preview`, title: '在新标签页查看增强集合的合并结果' }] : [];
}
