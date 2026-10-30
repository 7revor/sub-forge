import { additionsFromOverlay, mergeTemplate, profileEditorOverlay, Report, routingConfig, type Overlay } from '@sub-forge/core';
import type { ProfileDoc } from '../../hooks.ts';

export function boundTemplateId(p: ProfileDoc): string | undefined {
  return p.routing?.mode === 'bound' ? p.routing.templateId : p.routing ? undefined : p.template?.id;
}
export function persistedProfile(p: ProfileDoc): ProfileDoc {
  return { ...p, refPolicy: { default: 'wrap' }, ...(p.routing ? { overlay: {} } : {}) };
}
export function updateEditorOverlay(p: ProfileDoc, change: (o: Overlay) => Overlay): ProfileDoc {
  const overlay = change(profileEditorOverlay(p));
  if (!p.routing) return { ...p, overlay };
  if (p.routing.mode === 'independent') return { ...p, overlay: {}, routing: { ...p.routing, config: routingConfig(mergeTemplate(undefined, overlay, new Report())) } };
  const extraGroups = (overlay.extraGroups ?? []).map(extra => extra.group);
  const extraRules = overlay.extraRules ?? [];
  return { ...p, overlay: {}, routing: {
    ...p.routing,
    groupAdditions: additionsFromOverlay(overlay),
    ...((extraGroups.length || p.routing.extraGroups) ? { extraGroups } : {}),
    ...(p.routing.prependGroupIds ? { prependGroupIds: p.routing.prependGroupIds.filter(id => extraGroups.some(group => group.id === id)) } : {}),
    ...((extraRules.length || p.routing.prependRules) ? { prependRules: extraRules.filter(extra => extra.anchor === 'top').reverse().map(extra => extra.rule) } : {}),
    ...((p.routing.appendRules || extraRules.some(extra => extra.anchor === 'bottom')) ? { appendRules: extraRules.filter(extra => extra.anchor === 'bottom').map(extra => extra.rule) } : {}),
  } };
}
export function modeLabel(p: ProfileDoc, name?: string): string {
  if (p.routing?.mode === 'bound') return `绑定模板 · ${name ?? p.routing.templateId}`;
  if (p.routing?.mode === 'independent') return '独立配置';
  return p.template ? '旧配置' : '独立配置';
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
