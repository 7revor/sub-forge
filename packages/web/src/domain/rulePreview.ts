import { queryUrl, type Matcher, type RuleSetSource } from '@sub-forge/core';

export type RulePreviewLink = { href: string; label?: string; title?: string };

/** 源文件预览不依赖保存状态、账户令牌或客户端转换。 */
export function sourcePreviewHref(source: Pick<RuleSetSource, 'kind' | 'url'>): string | undefined {
  if (source.kind !== 'remote' || !source.url) return undefined;
  try {
    const url = new URL(source.url);
    return ['https:', 'http:'].includes(url.protocol) ? source.url : undefined;
  } catch { return undefined; }
}

/** 系统维护的规则集合没有上游地址，使用账户令牌打开托管的合并结果；令牌未就绪时不给链接。 */
export function rulePreviewLinks(matcher: Matcher, token?: string): RulePreviewLink[] {
  if (matcher.kind !== 'ruleset') return [];
  if (matcher.repository) return matcher.repository.sources.flatMap(source => {
    const href = source.enabled !== false && sourcePreviewHref(source);
    return href ? [{ href, label: source.name ?? source.repository?.path ?? href }] : [];
  });
  if (matcher.remote) {
    const href = sourcePreviewHref({ kind: 'remote', url: matcher.remote.url });
    return href ? [{ href }] : [];
  }
  return matcher.id && token ? [{ href: queryUrl('/resources/ruleset', { id: matcher.id, token }), title: '在新标签页查看规则集合的合并结果' }] : [];
}
