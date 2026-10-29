import { additionsFromOverlay, mergeTemplate, Report, resolveProfileRouting, routingConfig, stableStringify, type Template } from '@sub-forge/core';
import type { ProfileDoc, TemplateVersionDoc } from './docs.ts';

export function profileTemplate(profile: ProfileDoc, get: (id: string, version?: number) => TemplateVersionDoc | undefined): TemplateVersionDoc | undefined {
  if (profile.routing?.mode === 'independent') return undefined;
  if (profile.routing?.mode === 'bound') return get(profile.routing.templateId);
  return profile.template ? get(profile.template.id, profile.template.follow === 'latest' ? undefined : profile.template.follow.pinned) : undefined;
}

/** 不访问上游；只展开已保存的领域配置，节点与规则集仍保留引用。 */
export function migrateProfile(profile: ProfileDoc, template: TemplateVersionDoc | undefined): ProfileDoc {
  if (profile.routing) return profile;
  if (profile.template && !template) throw new Error(`订阅「${profile.name}」引用的模板版本缺失，迁移已中止，原配置保持不变`);
  profile = { ...profile, overlay: profile.overlay ?? {}, nodeSets: profile.nodeSets ?? [], chains: profile.chains ?? [], refPolicy: profile.refPolicy ?? { default: 'wrap' } };
  const report = new Report();
  const effective = mergeTemplate(template, profile.overlay, report);
  if (report.hasErrors) throw new Error(`订阅「${profile.name}」存在旧配置合并错误，迁移已中止：${report.items.map(i => i.message).join('；')}`);
  const overlay = profile.overlay;
  const additions = additionsFromOverlay(overlay);
  const allowed = new Set(['groupPatches']);
  const onlyMembers = Object.entries(overlay).every(([key, value]) => allowed.has(key) || value === undefined || (Array.isArray(value) && !value.length) || (value && typeof value === 'object' && !Object.keys(value).length))
    && Object.values(overlay.groupPatches ?? {}).every(p => Object.entries(p).every(([key, value]) => key === 'addMembers' || value === undefined || key === 'memberOrder' && value === 'append' || key === 'set' && value && typeof value === 'object' && !Object.keys(value).length));
  const canBind = !!template && profile.template?.follow === 'latest' && onlyMembers && !report.items.length;
  const { template: _template, ...rest } = profile;
  const reason = canBind ? '仅有追加成员，继续跟随模板' : profile.template?.follow !== 'latest' && profile.template ? '锁定版本已展开为独立配置' : profile.template ? '保留原有组参数、规则或私有配置，转为独立维护' : '空白订阅转为独立配置';
  const next: ProfileDoc = { ...rest, overlay: {}, revision: profile.revision ?? 1,
    routing: canBind ? { mode: 'bound', templateId: template.id, groupAdditions: additions } : {
      mode: 'independent', config: routingConfig(effective),
      ...(template ? { initializedFrom: { templateId: template.id, version: template.version, name: template.name } } : {}),
    },
    migration: { reason, issues: report.items },
    ...(canBind ? { templateVersion: template.version } : {}),
  };
  if (stableStringify(routingConfig(resolveProfileRouting(next, template, new Report()))) !== stableStringify(routingConfig(effective))) throw new Error(`订阅「${profile.name}」迁移前后配置不一致，迁移已中止`);
  return next;
}

export function independentProfile(profile: ProfileDoc, template?: Template): ProfileDoc {
  const report = new Report();
  const config = routingConfig(resolveProfileRouting(profile, template, report));
  if (report.items.some(i => i.level === 'error')) throw new Error(report.items.map(i => i.message).join('；'));
  const { template: _template, templateVersion: _version, ...rest } = profile;
  return { ...rest, overlay: {}, routing: { mode: 'independent', config,
    ...(template ? { initializedFrom: { templateId: template.id, version: template.version, ...('name' in template && typeof template.name === 'string' ? { name: template.name } : {}) } } : {}),
  } };
}
