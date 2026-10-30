import type { ChainRule, NodeSetID, Profile, Target } from '@sub-forge/core';
import { exactNodeFilter, nodeSetKey } from './memberModel.ts';

/** 只还原本编辑器生成的精确筛选；历史正则不能被误当成单个节点。 */
export function landingNodeName(landing: ChainRule['landing']): string | undefined {
  if (landing.excludeFilter || !landing.filter?.startsWith('^') || !landing.filter.endsWith('$')) return undefined;
  const name = landing.filter.slice(1, -1).replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
  return name && exactNodeFilter(name) === landing.filter ? name : undefined;
}

/** 同时检查落地、前置与嵌套回退，移出来源后不能留下悬空链引用。 */
export function chainUsesNodeSet(chain: ChainRule, ref: NodeSetID): boolean {
  const key = nodeSetKey(ref);
  const targetUses = (target: Target): boolean => target.kind === 'node' && (
    nodeSetKey(target.ref.nodeSet) === key || !!(target.ref.fallback && target.ref.fallback !== 'error' && targetUses(target.ref.fallback))
  );
  return nodeSetKey(chain.landing.nodeSet) === key || targetUses(chain.via);
}

export function removeProfileNodeSet<T extends Profile>(profile: T, ref: NodeSetID): T {
  return { ...profile, nodeSets: profile.nodeSets.filter(s => nodeSetKey(s.ref) !== nodeSetKey(ref)), chains: profile.chains.filter(c => !chainUsesNodeSet(c, ref)) };
}
