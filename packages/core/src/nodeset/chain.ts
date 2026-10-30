import type { ChainNodeSet, ProfileNodeSet } from '../types.ts';
import { nodeSetKey } from './resolve.ts';

/** 保持订阅来源顺序，前置从完整范围中采用首个匹配节点。 */
export function chainSources(scope: ChainNodeSet, nodeSets: ProfileNodeSet[]): ProfileNodeSet[] {
  return nodeSets.filter(source => scope.type === 'all' ? source.output === scope.id : nodeSetKey(source.ref) === nodeSetKey(scope));
}
