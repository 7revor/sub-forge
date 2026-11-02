import type { ChainTarget, GroupSpec, NodeSetID, Target } from '@sub-forge/core';
import type { ProfileDoc } from '../../hooks.ts';
import { newId } from '../../convert/templateYaml.ts';

/** 一次点击只追加一个订阅独立组，来源后续新增的节点自动进入该组。 */
export function appendProviderGroup(profile: ProfileDoc, ref: NodeSetID, name: string, groups: Pick<GroupSpec, 'name'>[]): ProfileDoc {
  if (!profile.nodeSets.some(n => n.output === 'provider' && n.ref.id === ref.id && n.ref.type === ref.type)) return profile;
  const base = name.trim() || '节点策略组';
  let unique = base;
  for (let suffix = 2; groups.some(group => group.name.trim() === unique); suffix++) unique = `${base} ${suffix}`;
  const group: GroupSpec = { id: newId('g'), name: unique, type: 'select', members: [{ kind: 'nodeset', ref: { ...ref } }] };
  const routing = profile.routing;
  return { ...profile, routing: routing.mode === 'independent'
    ? { ...routing, config: { ...routing.config, groups: [...routing.config.groups, group] } }
    : { ...routing, extraGroups: [...(routing.extraGroups ?? []), group] } };
}

/** 删除独立组时同时处理追加成员、前置规则及代理链，避免悬空引用。 */
export function removeIndependentGroup(profile: ProfileDoc, id: string): ProfileDoc {
  const uses = (target: ChainTarget): boolean => target.kind === 'group' ? target.groupId === id : target.kind === 'node' && !!target.ref.fallback && target.ref.fallback !== 'error' && uses(target.ref.fallback);
  const clean = (target: Target): Target => target.kind === 'group' && target.groupId === id ? { kind: 'builtin', name: 'REJECT' } : target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error' ? { ...target, ref: { ...target.ref, fallback: clean(target.ref.fallback) } } : target;
  const cleanGroups = (groups: GroupSpec[]) => groups.filter(group => group.id !== id).map(group => ({ ...group, members: cleanMembers(group.members) }));
  const cleanMembers = (members: GroupSpec['members']) => members.filter(m => m.kind !== 'group' || m.groupId !== id).map(m => m.kind === 'node' ? clean(m) : m);
  const cleanRules = (rules: import('@sub-forge/core').RuleEntry[]) => rules.map(rule => ({ ...rule, target: clean(rule.target) }));
  const routing = profile.routing;
  return { ...profile, routing: routing.mode === 'independent'
    ? { ...routing, config: { ...routing.config, groups: cleanGroups(routing.config.groups), rules: cleanRules(routing.config.rules), final: clean(routing.config.final) } }
    : { ...routing,
      groupAdditions: Object.fromEntries(Object.entries(routing.groupAdditions).map(([key, members]) => [key, cleanMembers(members)] as const).filter(([, members]) => members.length)),
      ...(routing.extraGroups ? { extraGroups: cleanGroups(routing.extraGroups) } : {}),
      ...(routing.prependGroupIds ? { prependGroupIds: routing.prependGroupIds.filter(groupId => groupId !== id) } : {}),
      ...(routing.prependRules ? { prependRules: cleanRules(routing.prependRules) } : {}),
      ...(routing.appendRules ? { appendRules: cleanRules(routing.appendRules) } : {}),
    }, chains: profile.chains.filter(chain => !uses(chain.via)) };
}
