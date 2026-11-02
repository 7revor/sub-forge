import type { GroupSpec, RoutingConfig } from '@sub-forge/core';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';

export function boundTemplateId(p: ProfileDoc): string | undefined {
  return p.routing.mode === 'bound' ? p.routing.templateId : undefined;
}

/** 编辑器的原始组：模板成员与追加成员分开，弹窗分别展示继承项和可编辑项。 */
export function editableProfileGroups(profile: ProfileDoc, template: TemplateDoc | undefined): (GroupSpec & { origin: 'template' | 'profile' })[] {
  const routing = profile.routing;
  if (routing.mode === 'independent') return routing.config.groups.map(group => ({ ...group, origin: 'profile' }));
  return [
    ...(template?.groups ?? []).map(group => ({ ...group, origin: 'template' as const })),
    ...(routing.extraGroups ?? []).map(group => ({ ...group, origin: 'profile' as const })),
  ];
}

export function withRoutingGroups(profile: ProfileDoc, config: RoutingConfig, template: TemplateDoc | undefined, templateStart?: number): ProfileDoc {
  const routing = profile.routing;
  if (routing.mode === 'independent') return { ...profile, routing: { ...routing, config } };
  const extraGroups = config.groups.filter(group => !template?.groups.some(g => g.id === group.id));
  const start = templateStart ?? (template?.groups.length ? config.groups.findIndex(g => g.id === template.groups[0]!.id) : config.groups.filter(g => routing.prependGroupIds?.includes(g.id)).length);
  return { ...profile, routing: { ...routing, extraGroups, prependGroupIds: extraGroups.slice(0, start).map(g => g.id) } };
}

export function withRoutingRules(profile: ProfileDoc, config: RoutingConfig, template: TemplateDoc | undefined, templateStart?: number): ProfileDoc {
  const routing = profile.routing;
  if (routing.mode === 'independent') return { ...profile, routing: { ...routing, config } };
  const custom = config.rules.filter(rule => !template?.rules.some(r => r.id === rule.id));
  const start = templateStart ?? (template?.rules.length ? config.rules.findIndex(r => r.id === template.rules[0]!.id) : custom.filter(r => routing.prependRules?.some(p => p.id === r.id)).length);
  return { ...profile, routing: { ...routing, prependRules: custom.slice(0, start), appendRules: custom.slice(start) } };
}

export function modeLabel(p: ProfileDoc, name?: string): string {
  return p.routing.mode === 'bound' ? `绑定模板 · ${name ?? p.routing.templateId}` : '独立配置';
}

/** 后台重新获取不能覆盖未保存的转换或编辑；订阅切换时才重建草稿。 */
export function syncProfileDraft(current: ProfileDoc | undefined, previous: ProfileDoc | undefined, incoming: ProfileDoc): ProfileDoc {
  return !current || current.id !== incoming.id || JSON.stringify(current) === JSON.stringify(previous) ? incoming : current;
}

/** 保存期间继续输入时保留后续修改。 */
export function acceptProfileSave(current: ProfileDoc | undefined, submitted: ProfileDoc, saved: ProfileDoc): ProfileDoc | undefined {
  if (!current || current.id !== saved.id) return current;
  return JSON.stringify(current) === JSON.stringify(submitted) ? saved : current;
}
