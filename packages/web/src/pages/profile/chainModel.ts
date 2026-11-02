import type { ChainRule, NodeRef, NodeSetID, Profile, ChainTarget } from '@sub-forge/core';
import { exactNodeFilter, NO_NODE_FILTER, nodeSetKey } from './memberModel.ts';

/** 只还原本编辑器生成的精确筛选；历史正则不能被误当成单个节点。 */
export function landingNodeName(landing: ChainRule['landing']): string | undefined {
  if (landing.excludeFilter || !landing.filter?.startsWith('^') || !landing.filter.endsWith('$')) return undefined;
  const name = landing.filter.slice(1, -1).replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
  return name && exactNodeFilter(name) === landing.filter ? name : undefined;
}

/** 还原编辑器勾选生成的 `^a$|^b$`；只要有一段不是精确名称就按历史正则处理。 */
export function landingNodeNames(landing: ChainRule['landing']): string[] | undefined {
  if (landing.excludeFilter || !landing.filter) return undefined;
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < landing.filter.length; i++) {
    const char = landing.filter[i]!;
    if (char === '\\') { current += char + (landing.filter[++i] ?? ''); continue; }
    if (char === '|') { parts.push(current); current = ''; continue; }
    current += char;
  }
  const names = [...parts, current].map(filter => landingNodeName({ nodeSet: landing.nodeSet, filter }));
  return names.every(name => name !== undefined) ? names as string[] : undefined;
}

export function viaConstraintHint(scope: string, match: NodeRef['match']): string {
  if ('exact' in match) return match.exact ? `范围：${scope} · 按名称精确匹配，节点改名后需重新点选` : `范围：${scope} · 尚未选择前置节点`;
  return match.regex ? `范围：${scope} · 沿用已有正则 ${match.regex}，点选节点可替换` : `范围：${scope} · 沿用已有规则：取排在最前的非落地节点，点选节点可替换`;
}

export function landingConstraintHint(scope: string, landing: ChainRule['landing']): string {
  if (landing.filter === NO_NODE_FILTER) return `范围：${scope} · 尚未选择落地节点`;
  if (!landing.filter && !landing.excludeFilter) return `范围：${scope} · 后续新增节点自动纳入，单独配置的节点按其规则`;
  if (landingNodeNames(landing)) return `范围：${scope} · 按名称精确匹配，节点改名后需重新勾选`;
  const rules = [landing.filter && `正则 ${landing.filter}`, landing.excludeFilter && `排除 ${landing.excludeFilter}`].filter(Boolean).join('，');
  return `范围：${scope} · 沿用已有${rules}，点选节点可替换`;
}

/** 同时检查落地、前置与嵌套回退，移出来源后不能留下悬空链引用。 */
export function chainUsesNodeSet(chain: ChainRule, ref: NodeSetID): boolean {
  const key = nodeSetKey(ref);
  const targetUses = (target: ChainTarget): boolean => target.kind === 'node' && (
    nodeSetKey(target.ref.nodeSet) === key || !!(target.ref.fallback && target.ref.fallback !== 'error' && targetUses(target.ref.fallback))
  );
  return nodeSetKey(chain.landing.nodeSet) === key || targetUses(chain.via);
}

export function removeProfileNodeSet<T extends Profile>(profile: T, ref: NodeSetID): T {
  return { ...profile, nodeSets: profile.nodeSets.filter(s => nodeSetKey(s.ref) !== nodeSetKey(ref)), chains: profile.chains.filter(c => !chainUsesNodeSet(c, ref)) };
}
