import type { ChainTarget, GroupSpec, NodeSetID, Target } from '@sub-forge/core';
import type { ProfileDoc } from '../../hooks.ts';
import { newId } from '../../convert/templateYaml.ts';
import { updateEditorOverlay } from './routing.ts';

/** 一次点击只追加一个订阅独立组，来源后续新增的节点自动进入该组。 */
export function appendProviderGroup(profile: ProfileDoc, ref: NodeSetID, name: string, groups: Pick<GroupSpec, 'name'>[]): ProfileDoc {
  if (!profile.nodeSets.some(n => n.output === 'provider' && n.ref.id === ref.id && n.ref.type === ref.type)) return profile;
  const base = name.trim() || '节点策略组';
  let unique = base;
  for (let suffix = 2; groups.some(group => group.name.trim() === unique); suffix++) unique = `${base} ${suffix}`;
  const group: GroupSpec = { id: newId('g'), name: unique, type: 'select', members: [{ kind: 'nodeset', ref: { ...ref } }] };
  return updateEditorOverlay(profile, overlay => ({ ...overlay, extraGroups: [...(overlay.extraGroups ?? []), { group }] }));
}

/** 删除独立组时同时处理追加成员、前置规则及代理链，避免悬空引用。 */
export function removeIndependentGroup(profile: ProfileDoc, id: string): ProfileDoc {
  const uses = (target: ChainTarget): boolean => target.kind === 'group' ? target.groupId === id : target.kind === 'node' && !!target.ref.fallback && target.ref.fallback !== 'error' && uses(target.ref.fallback);
  const clean = (target: Target): Target => target.kind === 'group' && target.groupId === id ? { kind: 'builtin', name: 'REJECT' } : target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error' ? { ...target, ref: { ...target.ref, fallback: clean(target.ref.fallback) } } : target;
  return { ...updateEditorOverlay(profile, overlay => ({ ...overlay,
    extraGroups: overlay.extraGroups?.filter(item => item.group.id !== id).map(item => ({ ...item, group: { ...item.group, members: item.group.members.filter(m => m.kind !== 'group' || m.groupId !== id).map(m => m.kind === 'node' ? clean(m) : m) } })),
    groupPatches: Object.fromEntries(Object.entries(overlay.groupPatches ?? {}).map(([key, patch]) => [key, { ...patch, addMembers: patch.addMembers?.filter(m => m.kind !== 'group' || m.groupId !== id).map(m => m.kind === 'node' ? clean(m) : m) }])),
    extraRules: overlay.extraRules?.map(item => ({ ...item, rule: { ...item.rule, target: clean(item.rule.target) } })),
    ...(overlay.final ? { final: clean(overlay.final) } : {}),
  })), chains: profile.chains.filter(chain => !uses(chain.via)) };
}
