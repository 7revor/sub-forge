import type { GroupSpec, Profile, ChainTarget } from '@sub-forge/core';

/** 只要求映射仍需保留的填充及引用，避免为无关策略组制造空表单。 */
export function associationRequirements(profile: Profile, groups: GroupSpec[], mapping: Record<string, string> = {}) {
  const required = new Map<string, { id: string; name: string; reasons: string[]; canDrop: boolean }>();
  const add = (id: string, reason: string, reference = false) => {
    const item = required.get(id) ?? { id, name: groups.find(g => g.id === id)?.name ?? id, reasons: [], canDrop: true };
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    if (reference) item.canDrop = false;
    required.set(id, item);
  };
  const visit = (target: ChainTarget, reason: string) => {
    if (target.kind === 'group') add(target.groupId, reason, true);
    else if (target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error') visit(target.ref.fallback, reason);
  };
  for (const group of groups) {
    const members = profile.routing?.mode === 'bound' ? profile.routing.groupAdditions[group.id] ?? [] : group.members.filter(m => ['node', 'nodeset', 'all'].includes(m.kind));
    if (!members.length) continue;
    add(group.id, `${members.length} 项节点填充`);
    if (mapping[group.id] !== '__drop') for (const member of members) if (member.kind === 'node' || member.kind === 'group') visit(member, '成员引用');
  }
  for (const chain of profile.chains) visit(chain.via, '代理链引用');
  if (profile.routing?.mode === 'bound') for (const rule of profile.routing.prependRules ?? []) visit(rule.target, '前置规则出口');
  return [...required.values()];
}

export function inferAssociationMapping(groups: GroupSpec[], target: GroupSpec[]) {
  return Object.fromEntries(groups.flatMap(group => {
    const matches = target.filter(item => item.name === group.name);
    const match = target.find(item => item.id === group.id) ?? (matches.length === 1 ? matches[0] : undefined);
    return match ? [[group.id, match.id]] : [];
  }));
}
