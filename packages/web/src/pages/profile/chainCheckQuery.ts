import { queryOptions } from '@tanstack/react-query';
import { api, type ProfilePreview } from '../../api.ts';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';

/** 模板已没有版本号；有效内容变化必须让代理链诊断重新计算。 */
export function chainCheckSnapshot(profile: ProfileDoc, template: TemplateDoc | undefined): string {
  return JSON.stringify({ profile, ...(profile.routing.mode === 'bound' && template ? {
    template: { id: template.id, groups: template.groups, rules: template.rules, final: template.final },
  } : {}) });
}

export function chainCheckOptions(snapshot: string) {
  const { profile } = JSON.parse(snapshot) as { profile: ProfileDoc };
  return queryOptions({
    queryKey: ['profile-chain-check', snapshot],
    queryFn: () => api<ProfilePreview>('POST', profile.id ? `/profiles/${profile.id}/preview` : '/profiles/preview', { profile, client: 'mihomo' }),
    retry: false, refetchOnWindowFocus: false, staleTime: 0,
  });
}
