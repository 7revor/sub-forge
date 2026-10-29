import type { Matcher } from '@sub-forge/core';

/** 切换匹配类型时丢弃旧分支字段，保留未知扩展信息。 */
export function changeMatcherKind(matcher: Matcher, kind: Matcher['kind']): Matcher {
  if (matcher.kind === kind) return matcher;
  const { rule: _rule, id: _id, overrides: _overrides, repository: _repository, ...rest } = matcher as { rule?: unknown; id?: string; overrides?: unknown; repository?: unknown };
  return kind === 'rule' ? { ...rest, kind, rule: { type: 'RAW', text: '' } } : { ...rest, kind, id: '' };
}
