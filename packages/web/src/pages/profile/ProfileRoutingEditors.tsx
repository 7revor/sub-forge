// 订阅与模板使用同一套列表和弹窗；订阅补充节点成员与独立规则出口。
import { Report, resolveProfileRouting, routingConfig, withGroupHidden } from '@sub-forge/core';
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
import { planProfileChange } from './chainModel.ts';
import { ProfileGroupDialog } from './ProfileGroupDialog.tsx';
import { withRoutingGroups, withRoutingRules } from './routing.ts';

function useRoutingBody() {
  const { draft, setDraft, template } = useProfile();
  const routing = draft.routing;
  const bound = routing.mode === 'bound';
  const body: TemplateBody = routing.mode === 'independent' ? routing.config : routingConfig(resolveProfileRouting(draft, template, new Report()));
  const update = (config: TemplateBody, templateStart?: number) => setDraft(withRoutingGroups(draft, config, template, templateStart));
  return { body, update, bound };
}

export function ProfileGroupsEditor() {
  const profile = useProfile();
  const { draft, setDraft, template, groupName, nodeSetName } = profile;
  const { body, update, bound } = useRoutingBody();
  return <>
    <TemplateGroupsEditor value={body} onChange={update} report={draftIssues(body)} templateGroupIds={bound ? template?.groups.map(g => g.id) ?? [] : undefined} templateStart={draft.routing?.mode === 'bound' ? draft.routing.prependGroupIds?.length ?? 0 : undefined} isGroupReadOnly={group => bound && !!template?.groups.some(g => g.id === group.id)} nodeSetName={nodeSetName}
      hiddenOverride={draft.routing?.mode === 'bound' && template ? {
        inherited: group => { const origin = template.groups.find(g => g.id === group.id); return origin && !!origin.display?.hidden; },
        set: (group, hidden) => { if (draft.routing?.mode === 'bound') setDraft({ ...draft, routing: withGroupHidden(draft.routing, template, group.id, hidden) }); },
      } : undefined}
      onRemoveGroup={async group => {
        const removed = removeIndependentGroup(draft, group.id);
        // 随组移除的代理链继续向后影响其他组的成员。
        const cascade = planProfileChange({ ...removed, chains: draft.chains }, { chains: removed.chains });
        const result = await Frame.modal.confirm({ title: `删除策略组「${group.name}」？`, description: `同时移除组内成员引用及引用它的代理链，相关规则出口改为 REJECT。保存订阅后生效。${cascade.members.length ? `\n\n以下成员不再经过代理链，将一起清除：\n${cascade.members.map(({ groupId, member }) => `${groupName(groupId)}：${memberLabel(member, groupName, nodeSetName).text}`).join('\n')}` : ''}`, confirmLabel: '删除', danger: true });
        if (result.status === 'confirmed') setDraft(cascade.next);
      }}
      memberSummary={group => {
        return group.members.map(m => memberLabel(m, groupName, nodeSetName).text).join(' · ') || '没有成员，流量会被拒绝';
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
  const inlineNodeSets = profileNodeSets.filter(set => draft.nodeSets.some(n => n.output === 'inline' && n.ref.type === set.ref.type && n.ref.id === set.ref.id));
  const { body, bound } = useRoutingBody();
  const rulesets = useRuleSetRefs();
  const props = { ctx: { rulesets: rulesets.data ?? [] }, onRuleValidationReady: () => {}, renderTarget: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => <RuleTargetSelect label={label} value={value} onChange={onChange} groups={groupOptions} nodeSets={inlineNodeSets} />, inlineNodeSets, extendedOptions: true };
  const changeRules = (next: TemplateBody, templateStart?: number) => setDraft(withRoutingRules(draft, next, template, templateStart));
  return <>
    <ErrorAlert error={rulesets.error} />
    <TemplateRulesEditor {...props} value={body} onChange={changeRules} report={draftIssues(body)} title="规则"
      templateRuleIds={bound ? template?.rules.map(r => r.id) ?? [] : undefined} templateStart={draft.routing?.mode === 'bound' ? draft.routing.prependRules?.length ?? 0 : undefined} />
  </>;
}
