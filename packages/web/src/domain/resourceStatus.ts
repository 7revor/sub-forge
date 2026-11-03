// 资源缓存状态：节点始终保留一份副本，没有内容才算问题；规则到期即失效，没有快照是正常状态。
export type ResourceState = { kind?: 'source' | 'ruleset'; resource?: string; repositoryId?: string; name: string; lastSuccessAt?: number; lastAttemptAt?: number; refreshing: boolean; error?: string; available: boolean };
export type ResourceSummary = { label: string; tone: 'neutral' | 'ok' | 'warn' };

export function resourceCacheSummary(kind: string, items: ResourceState[]): ResourceSummary {
  if (!items.length) return { label: '本地资源', tone: 'neutral' };
  if (items.some(r => r.refreshing)) return { label: '刷新中', tone: 'neutral' };
  const nodes = items.filter(r => r.kind !== 'ruleset');
  const failed = nodes.filter(r => r.error), missing = nodes.filter(r => !r.available);
  if (failed.length) return { label: `${failed.length} 项失败${missing.length ? ' · 有资源不可用' : ' · 使用旧内容'}`, tone: 'warn' };
  if (missing.length) return { label: '待首次拉取', tone: 'warn' };
  const available = items.filter(r => r.available).length;
  if (!available) return { label: '使用时拉取', tone: 'neutral' };
  return { label: kind === 'sources' ? '正常' : `${available} 项可用`, tone: 'ok' };
}

export function resourceCacheHint(r: ResourceState, formatTime: (at: number) => string): string {
  const when = r.lastSuccessAt ? formatTime(r.lastSuccessAt) : undefined;
  if (r.kind === 'ruleset') return `${r.name}：${when ? `本周期已拉取 ${when}` : '使用时拉取'}`;
  return `${r.name}：最后成功 ${when ?? '无'}${r.error ? `；${r.error}` : ''}`;
}
