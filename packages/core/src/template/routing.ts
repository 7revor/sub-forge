// 订阅分流配置：绑定模式只补充成员，独立模式拥有完整配置。
import type { GroupMember, Overlay, Profile, RoutingConfig, Template } from '../types.ts';
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
  if (routing.mode === 'bound') return { groupPatches: Object.fromEntries(Object.entries(routing.groupAdditions).map(([id, addMembers]) => [id, { addMembers }])) };
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
  const effective = mergeTemplate(template, profileEditorOverlay(profile), report);
  for (const cycle of findGroupCycles(effective.groups)) report.error('binding.group-cycle', `模板与追加成员的组引用成环：${cycle.join(' → ')}`);
  return effective;
}

export function additionsFromOverlay(overlay: Overlay): Record<string, GroupMember[]> {
  return Object.fromEntries(Object.entries(overlay.groupPatches ?? {}).filter(([, p]) => p.addMembers?.length).map(([id, p]) => [id, p.addMembers!]));
}
