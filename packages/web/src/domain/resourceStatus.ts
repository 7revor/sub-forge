// 列表状态只看节点来源：节点始终保留一份副本，失败和没有内容才算问题；规则到期即失效且不记录失败，不参与状态判断。
export type ResourceState = { kind?: 'source' | 'ruleset'; resource?: string; repositoryId?: string; name: string; lastSuccessAt?: number; lastAttemptAt?: number; refreshing: boolean; error?: string; available: boolean };
export type ResourceSummary = { label: string; tone: 'neutral' | 'ok' | 'warn' };

export const nodeResources = (items: ResourceState[]) => items.filter(r => r.kind !== 'ruleset');

export function resourceCacheSummary(items: ResourceState[]): ResourceSummary {
  const nodes = nodeResources(items);
  if (!nodes.length) return { label: '本地资源', tone: 'neutral' };
  if (nodes.some(r => r.refreshing)) return { label: '刷新中', tone: 'neutral' };
  const failed = nodes.filter(r => r.error), missing = nodes.filter(r => !r.available);
  if (failed.length) return { label: `${failed.length} 项失败${missing.length ? ' · 有资源不可用' : ' · 使用旧内容'}`, tone: 'warn' };
  if (missing.length) return { label: '待首次拉取', tone: 'warn' };
  return { label: '正常', tone: 'ok' };
}

export function resourceCacheHint(r: ResourceState, formatTime: (at: number) => string): string {
  const when = r.lastSuccessAt ? formatTime(r.lastSuccessAt) : undefined;
  return `${r.name}：最后成功 ${when ?? '无'}${r.error ? `；${r.error}` : ''}`;
}
