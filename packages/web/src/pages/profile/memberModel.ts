import { compileUserRegex, type ChainRule, type GroupMember, type GroupSpec, type NodeSetID } from '@sub-forge/core';

export const nodeSetKey = (ref: NodeSetID) => `${ref.type}:${ref.id}`;
export function memberKey(member: GroupMember): string {
  switch (member.kind) {
    case 'nodeset': return `set:${nodeSetKey(member.ref)}`;
    case 'node': return `node:${nodeSetKey(member.ref.nodeSet)}:${JSON.stringify(member.ref.match)}`;
    case 'group': return `group:${member.groupId}`;
    case 'builtin': return `builtin:${member.name}`;
    case 'all': return `all:${member.scope}`;
  }
}
export function toggleMember(members: GroupMember[], member: GroupMember, checked: boolean, inherited: GroupMember[] = []): GroupMember[] {
  const key = memberKey(member);
  if (inherited.some(item => memberKey(item) === key)) return members;
  if (!checked) return members.filter(item => memberKey(item) !== key);
  return members.some(item => memberKey(item) === key) ? members : [...members, member];
}
/** 防止通过其他策略组间接引用自己。 */
export function canReferenceGroup(groups: GroupSpec[], owner: string, target: string): boolean {
  const visited = new Set<string>();
  const reachesOwner = (id: string): boolean => {
    if (id === owner) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return groups.find(g => g.id === id)?.members.some(m => m.kind === 'group' && reachesOwner(m.groupId)) ?? false;
  };
  return !reachesOwner(target);
}
export function exactNodeFilter(name: string): string {
  const escaped = Array.from(name, char => '.*+?^${}()|[]'.includes(char) || char.charCodeAt(0) === 92 ? String.fromCharCode(92) + char : char).join('');
  return `^${escaped}$`;
}
export function chainInputError(chain: ChainRule): string | undefined {
  try {
    if (chain.landing.filter) compileUserRegex(chain.landing.filter);
    if (chain.landing.excludeFilter) compileUserRegex(chain.landing.excludeFilter);
    if (chain.via.kind === 'group' && !chain.via.groupId) return '请选择前置策略组';
    if (chain.via.kind === 'node') {
      const ref = chain.via.ref;
      if (!ref.nodeSet.id || ('exact' in ref.match && !ref.match.exact.trim())) return '请选择前置节点';
      if ('regex' in ref.match) compileUserRegex(ref.match.regex);
      if (nodeSetKey(ref.nodeSet) === nodeSetKey(chain.landing.nodeSet) && !chain.landing.filter && !chain.landing.excludeFilter) return '前置与整集落地不能使用同一节点集，会形成循环';
      if (nodeSetKey(ref.nodeSet) === nodeSetKey(chain.landing.nodeSet) && 'exact' in ref.match) {
        const included = !chain.landing.filter || compileUserRegex(chain.landing.filter).test(ref.match.exact);
        const excluded = !!chain.landing.excludeFilter && compileUserRegex(chain.landing.excludeFilter).test(ref.match.exact);
        if (included && !excluded) return '前置节点也在落地范围内，会形成循环；请更换前置或排除此节点';
      }
    }
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  if (!chain.landing.nodeSet.id) return '请选择落地节点来源';
  return undefined;
}

export function sameLanding(a: ChainRule['landing'], b: ChainRule['landing']): boolean {
  return nodeSetKey(a.nodeSet) === nodeSetKey(b.nodeSet) && (a.filter ?? '') === (b.filter ?? '') && (a.excludeFilter ?? '') === (b.excludeFilter ?? '');
}
export function putChain(chains: ChainRule[], chain: ChainRule): ChainRule[] {
  const byId = chains.findIndex(c => c.id === chain.id);
  const index = byId >= 0 ? byId : chains.findIndex(c => sameLanding(c.landing, chain.landing));
  return index < 0 ? [...chains, chain] : chains.map((c, i) => i === index ? chain : c);
}
