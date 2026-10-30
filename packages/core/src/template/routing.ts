// 订阅分流配置：绑定模式补充成员与前置本地规则，独立模式拥有完整配置。
import type { GroupMember, Overlay, Profile, RoutingConfig, Target, Template } from '../types.ts';
import { Report } from '../report.ts';
import { findGroupCycles, mergeTemplate, type Effective } from './merge.ts';

export function routingConfig(effective: RoutingConfig): RoutingConfig {
  return structuredClone({
    groups: effective.groups.map(({ ...group }) => { delete (group as Record<string, unknown>).origin; return group; }),
    rules: effective.rules.map(({ ...rule }) => { delete (rule as Record<string, unknown>).origin; return rule; }),
    final: effective.final,
  });
}

/** 兼容编辑器的覆盖层视图；持久化只使用 routing，避免两个配置来源。 */
export function profileEditorOverlay(profile: Pick<Profile, 'routing' | 'overlay'>): Overlay {
  const routing = profile.routing;
  if (!routing) return profile.overlay;
  if (routing.mode === 'bound') return {
    groupPatches: Object.fromEntries(Object.entries(routing.groupAdditions).map(([id, addMembers]) => [id, { addMembers }])),
    // 覆盖层逐条 unshift，倒序保存才能保持前置规则的显示顺序。
    extraRules: [...(routing.prependRules ?? [])].reverse().map(rule => ({ anchor: 'top', rule })),
  };
  return { extraGroups: routing.config.groups.map(group => ({ group })), extraRules: routing.config.rules.map(rule => ({ anchor: 'bottom' as const, rule })), final: routing.config.final };
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
  const ruleIds = new Set(template.rules.map(rule => rule.id));
  const checkTarget = (target: Target, where: string, depth = 0): void => {
    if (depth > 20) { report.error('binding.prepend-target', '前置规则的兜底引用过深', where); return; }
    if (target.kind === 'group' && !template.groups.some(group => group.id === target.groupId)) report.error('binding.prepend-target', `前置规则引用的策略组 ${target.groupId} 已不存在`, where);
    if (target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error') checkTarget(target.ref.fallback, where, depth + 1);
  };
  for (const rule of profile.routing.prependRules ?? []) {
    if (rule.matcher.kind !== 'rule' && rule.matcher.kind !== 'local') report.error('binding.prepend-ruleset', '前置规则只能使用本地规则', `rule:${rule.id}`);
    if (ruleIds.has(rule.id)) report.error('binding.duplicate-rule', `前置规则 ID ${rule.id} 与现有规则重复`, `rule:${rule.id}`);
    ruleIds.add(rule.id);
    checkTarget(rule.target, `rule:${rule.id}`);
  }
  const effective = mergeTemplate(template, profileEditorOverlay(profile), report);
  for (const cycle of findGroupCycles(effective.groups)) report.error('binding.group-cycle', `模板与追加成员的组引用成环：${cycle.join(' → ')}`);
  return effective;
}

export function additionsFromOverlay(overlay: Overlay): Record<string, GroupMember[]> {
  return Object.fromEntries(Object.entries(overlay.groupPatches ?? {}).filter(([, p]) => p.addMembers?.length).map(([id, p]) => [id, p.addMembers!]));
}
