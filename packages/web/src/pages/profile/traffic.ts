import type { Collection, NodeSetID } from '@sub-forge/core';
import type { ProfileDoc } from '../../hooks.ts';

/** 旧汇总设置按实际节点来源回显，包含嵌套组合；选择后保存显式列表。 */
export function trafficSourceIds(profile: Pick<ProfileDoc, 'userinfo' | 'nodeSets'>, collections: Collection[]): string[] {
  const info = profile.userinfo;
  if (info?.mode === 'sources') return info.sourceIds;
  if (info?.mode === 'source') return [info.sourceId];
  if (info?.mode === 'none') return [];
  const ids = new Set<string>(), seen = new Set<string>();
  const visit = (ref: NodeSetID) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (ref.type === 'source') ids.add(ref.id);
    if (ref.type === 'collection') collections.find(c => c.id === ref.id)?.members.forEach(m => visit(m.ref));
  };
  profile.nodeSets.forEach(n => visit(n.ref));
  return [...ids];
}
