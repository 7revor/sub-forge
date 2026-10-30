// 订阅与模板使用同一套列表和弹窗；订阅补充节点成员与独立规则出口。
import { Report, resolveProfileRouting, routingConfig } from '@sub-forge/core';
import { profileModalData } from './modalProfile.ts';
import { memberLabel } from '../../components/pickers.tsx';
import { RuleTargetSelect } from '../../components/RuleTargetSelect.tsx';
import { ErrorAlert } from '../../components/ui.tsx';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { useRuleSetRefs } from '../../hooks.ts';
import { TemplateGroupsEditor } from '../template/TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from '../template/TemplateRulesEditor.tsx';
import { draftIssues } from '../template/model.ts';
import { useProfile } from './context.ts';
import { Frame } from '../../modals/Frame.tsx';
import { removeIndependentGroup } from './providerGroup.ts';
import { ProfileGroupDialog } from './ProfileGroupDialog.tsx';

function useRoutingBody() {
  const { draft, setDraft, template } = useProfile();
  const routing = draft.routing;
  const bound = routing?.mode === 'bound';
  const base: TemplateBody = template ?? { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } };
  const body: TemplateBody = routing?.mode === 'independent' ? routing.config : routing?.mode === 'bound' ? routingConfig(resolveProfileRouting(draft, template, new Report())) : base;
  const update = (config: TemplateBody, templateStart?: number) => {
    if (routing?.mode === 'independent') setDraft({ ...draft, routing: { ...routing, config } });
    else if (routing?.mode === 'bound') {
      const extraGroups = config.groups.filter(group => !template?.groups.some(g => g.id === group.id));
      const start = templateStart ?? (template?.groups.length ? config.groups.findIndex(g => g.id === template.groups[0]!.id) : config.groups.filter(g => routing.prependGroupIds?.includes(g.id)).length);
      setDraft({ ...draft, routing: { ...routing, extraGroups, prependGroupIds: extraGroups.slice(0, start).map(g => g.id) } });
    }
  };
  return { body, update, bound };
}

export function ProfileGroupsEditor() {
  const profile = useProfile();
  const { draft, setDraft, template, groupName, nodeSetName } = profile;
  const { body, update, bound } = useRoutingBody();
  return <>
    <TemplateGroupsEditor value={body} onChange={update} report={draftIssues(body)} templateGroupIds={bound ? template?.groups.map(g => g.id) ?? [] : undefined} templateStart={draft.routing?.mode === 'bound' ? draft.routing.prependGroupIds?.length ?? 0 : undefined} isGroupReadOnly={group => bound && !!template?.groups.some(g => g.id === group.id)} nodeSetName={nodeSetName}
      onRemoveGroup={async group => {
        const result = await Frame.modal.confirm({ title: `删除策略组「${group.name}」？`, description: '同时移除组内成员引用及引用它的代理链，相关规则出口改为 REJECT。保存订阅后生效。', confirmLabel: '删除', danger: true });
        if (result.status === 'confirmed') setDraft(removeIndependentGroup(draft, group.id));
      }}
      memberSummary={group => {
        return group.members.map(m => memberLabel(m, groupName, nodeSetName).text).join(' · ') || '尚未添加成员';
      }} onEditGroup={async (group, adding) => {
        const data = profileModalData(profile);
        if (adding && data.profile.routing?.mode === 'independent') data.profile = { ...data.profile, routing: { ...data.profile.routing, config: { ...data.profile.routing.config, groups: [...data.profile.routing.config.groups, group] } } };
        if (adding && data.profile.routing?.mode === 'bound') data.profile = { ...data.profile, routing: { ...data.profile.routing, extraGroups: [...(data.profile.routing.extraGroups ?? []), group] } };
        const result = await ProfileGroupDialog.show({ ...data, groupId: group.id });
        if (result.status === 'confirmed') setDraft(result.data);
      }} />
  </>;
}

export function ProfileRulesEditor() {
  const { draft, setDraft, template, groupOptions, profileNodeSets } = useProfile();
  const { body, update, bound } = useRoutingBody();
  const rulesets = useRuleSetRefs();
  const props = { ctx: { rulesets: rulesets.data ?? [] }, onRuleValidationReady: () => {}, renderTarget: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => <RuleTargetSelect label={label} value={value} onChange={onChange} groups={groupOptions} nodeSets={profileNodeSets} />, extendedOptions: true };
  const changeRules = (next: TemplateBody, templateStart?: number) => {
    if (draft.routing?.mode !== 'bound') { update(next); return; }
    const custom = next.rules.filter(rule => !template?.rules.some(r => r.id === rule.id));
    const start = templateStart ?? (template?.rules.length ? next.rules.findIndex(r => r.id === template.rules[0]!.id) : custom.filter(r => draft.routing?.mode === 'bound' && draft.routing.prependRules?.some(p => p.id === r.id)).length);
    setDraft({ ...draft, routing: { ...draft.routing, prependRules: custom.slice(0, start), appendRules: custom.slice(start) } });
  };
  return <>
    <ErrorAlert error={rulesets.error} />
    <TemplateRulesEditor {...props} value={body} onChange={changeRules} report={draftIssues(body)} title="规则"
      templateRuleIds={bound ? template?.rules.map(r => r.id) ?? [] : undefined} templateStart={draft.routing?.mode === 'bound' ? draft.routing.prependRules?.length ?? 0 : undefined} />
  </>;
}
