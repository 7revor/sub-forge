// 订阅分流配置：绑定模式补充成员与模板前后的自定义规则，独立模式拥有完整配置。
import type { GroupMember, Overlay, Profile, ProfileRouting, RoutingConfig, Target, Template } from '../types.ts';
import { Report } from '../report.ts';
import { findGroupCycles, mergeTemplate, type Effective } from './merge.ts';

export function routingConfig(effective: RoutingConfig): RoutingConfig {
  return structuredClone({
    groups: effective.groups.map(({ ...group }) => { delete (group as Record<string, unknown>).origin; return group; }),
    rules: effective.rules.map(({ ...rule }) => { delete (rule as Record<string, unknown>).origin; return rule; }),
    final: effective.final,
  });
}

export function resolveProfileRouting(profile: Pick<Profile, 'routing' | 'overlay'>, template: Template | undefined, report: Report): Effective {
  if (!profile.routing) return mergeTemplate(template, profile.overlay, report);
  if (profile.routing.mode === 'independent') return {
    groups: profile.routing.config.groups.map(g => ({ ...g, origin: 'profile' })),
    rules: profile.routing.config.rules.map(r => ({ ...r, origin: 'profile' })), final: profile.routing.config.final,
  };
  if (!template || template.id !== profile.routing.templateId) {
    report.error('binding.template-missing', '绑定的模板不存在');
    return { groups: [], rules: [], final: { kind: 'builtin', name: 'REJECT' } };
  }
  for (const [id, members] of Object.entries(profile.routing.groupAdditions)) {
    if (members.length && !template.groups.some(g => g.id === id)) report.error('binding.orphan', `策略组 ${id} 已删除，必须先迁移或移除它的追加成员`, `group:${id}`);
  }
  const groups = [...template.groups, ...(profile.routing.extraGroups ?? [])];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id) || names.has(group.name.trim())) report.error('binding.duplicate-group', `策略组「${group.name}」的 ID 或名称与现有组重复`, `group:${group.id}`);
    ids.add(group.id); names.add(group.name.trim());
  }
  const ruleIds = new Set(template.rules.map(rule => rule.id));
  const checkTarget = (target: Target, where: string, depth = 0): void => {
    if (depth > 20) { report.error('binding.prepend-target', '自定义规则的兜底引用过深', where); return; }
    if (target.kind === 'group' && !groups.some(group => group.id === target.groupId)) report.error('binding.prepend-target', `自定义规则引用的策略组 ${target.groupId} 已不存在`, where);
    if (target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error') checkTarget(target.ref.fallback, where, depth + 1);
  };
  for (const rule of [...(profile.routing.prependRules ?? []), ...(profile.routing.appendRules ?? [])]) {
    if (ruleIds.has(rule.id)) report.error('binding.duplicate-rule', `自定义规则 ID ${rule.id} 与现有规则重复`, `rule:${rule.id}`);
    ruleIds.add(rule.id);
    checkTarget(rule.target, `rule:${rule.id}`);
  }
  const routing = profile.routing;
  const effective: Effective = {
    groups: [
      ...template.groups.map(group => ({ ...group, members: [...group.members, ...(routing.groupAdditions[group.id] ?? [])], origin: 'template' as const })),
      ...(profile.routing.extraGroups ?? []).map(group => ({ ...group, origin: 'profile' as const })),
    ],
    rules: [
      ...(profile.routing.prependRules ?? []).map(rule => ({ ...rule, origin: 'profile' as const })),
      ...template.rules.map(rule => ({ ...rule, origin: 'template' as const })),
      ...(profile.routing.appendRules ?? []).map(rule => ({ ...rule, origin: 'profile' as const })),
    ],
    final: template.final,
  };
  const groupHidden = profile.routing.groupHidden ?? {};
  for (const id of Object.keys(groupHidden)) {
    if (!template.groups.some(g => g.id === id)) report.warn('binding.orphan', `策略组 ${id} 已删除，它的隐藏设置不再生效`, `group:${id}`);
  }
  effective.groups = effective.groups.map(g => {
    const hidden = g.origin === 'template' ? groupHidden[g.id] : undefined;
    return hidden === undefined ? g : { ...g, display: { ...g.display, hidden } };
  });
  const before = new Set(profile.routing.prependGroupIds ?? []);
  effective.groups = [...effective.groups.filter(g => g.origin === 'profile' && before.has(g.id)), ...effective.groups.filter(g => g.origin === 'template'), ...effective.groups.filter(g => g.origin === 'profile' && !before.has(g.id))];
  for (const cycle of findGroupCycles(effective.groups)) report.error('binding.group-cycle', `模板与追加成员的组引用成环：${cycle.join(' → ')}`);
  return effective;
}

/** 设置模板组在本订阅的隐藏状态：与模板相同即恢复跟随，同时清理已删除组的旧记录。 */
export function withGroupHidden<R extends Extract<ProfileRouting, { mode: 'bound' }>>(routing: R, template: Pick<Template, 'groups'>, id: string, hidden: boolean): R {
  const next = Object.fromEntries(Object.entries(routing.groupHidden ?? {}).filter(([key]) => key !== id && template.groups.some(g => g.id === key)));
  if (hidden !== !!template.groups.find(g => g.id === id)?.display?.hidden) next[id] = hidden;
  const { groupHidden: _old, ...rest } = routing;
  return (Object.keys(next).length ? { ...rest, groupHidden: next } : rest) as R;
}

export function additionsFromOverlay(overlay: Overlay): Record<string, GroupMember[]> {
  return Object.fromEntries(Object.entries(overlay.groupPatches ?? {}).filter(([, p]) => p.addMembers?.length).map(([id, p]) => [id, p.addMembers!]));
}
