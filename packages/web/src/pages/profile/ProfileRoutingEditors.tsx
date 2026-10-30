// 订阅与模板使用同一套列表和弹窗；订阅补充节点成员与独立规则出口。
import type { RuleEntry } from '@sub-forge/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { ClientOverrides } from '../../components/ClientOverrides.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { RuleTargetSelect } from '../../components/RuleTargetSelect.tsx';
import { ErrorAlert, Switch } from '../../components/ui.tsx';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { useRuleSetRefs } from '../../hooks.ts';
import { TemplateGroupsEditor } from '../template/TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from '../template/TemplateRulesEditor.tsx';
import { draftIssues } from '../template/model.ts';
import { useProfile } from './context.ts';
import { ProfileGroupDialog } from './ProfileGroupDialog.tsx';

function useRoutingBody() {
  const { draft, setDraft, template } = useProfile();
  const routing = draft.routing;
  const bound = routing?.mode === 'bound';
  const body: TemplateBody = routing?.mode === 'independent' ? routing.config : template ?? { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } };
  const update = (config: TemplateBody) => {
    if (routing?.mode === 'independent') setDraft({ ...draft, routing: { ...routing, config } });
  };
  return { body, update, bound };
}

export function ProfileGroupsEditor() {
  const { draft, template, groupName, nodeSetName } = useProfile();
  const { body, update, bound } = useRoutingBody();
  const [selected, setSelected] = useState<string>();
  return <>
    {bound && <p className="m-0 text-[13px] text-ink-muted">策略组结构跟随 <Link className="text-brand" to={`/templates/${template?.id}`}>{template?.name ?? '模板'}</Link>。点击编辑，为各组填充本订阅的节点。</p>}
    <TemplateGroupsEditor value={body} onChange={update} selected={selected} onSelect={setSelected} report={draftIssues(body)} readOnly={bound} saveHint="保存订阅后生效" nodeSetName={nodeSetName}
      memberSummary={group => {
        const additions = draft.routing?.mode === 'bound' ? draft.routing.groupAdditions[group.id] ?? [] : [];
        return [...group.members, ...additions].map(m => memberLabel(m, groupName, nodeSetName).text).join(' · ') || '尚未添加成员';
      }} renderGroupDialog={(group, close) => <ProfileGroupDialog key={group.id} groupId={group.id} onClose={close} />} />
  </>;
}

function RuleOptions({ rule, onChange }: { rule: RuleEntry; onChange: (rule: RuleEntry) => void }) {
  const matcher = rule.matcher;
  return matcher.kind !== 'ruleset' ? <details><summary className="cursor-pointer text-[13px]">客户端覆盖</summary><div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={overrides => onChange({ ...rule, matcher: { ...matcher, overrides } })} /></div></details>
    : <label className="flex items-center gap-2 text-[13px]"><Switch label="规则级 src" checked={rule.options?.src === true} onChange={src => onChange({ ...rule, options: { ...rule.options, src } })} />src</label>;
}

export function ProfileRulesEditor() {
  const { draft, setDraft, groupOptions, profileNodeSets } = useProfile();
  const { body, update, bound } = useRoutingBody();
  const [selected, setSelected] = useState<string>();
  const [extra, setExtra] = useState<string>();
  const rulesets = useRuleSetRefs();
  const props = { ctx: { rulesets: rulesets.data ?? [] }, saveHint: '保存订阅后生效', onRuleValidationReady: () => {}, renderTarget: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => <RuleTargetSelect label={label} value={value} onChange={onChange} groups={groupOptions} nodeSets={profileNodeSets} />, renderOptions: (rule: RuleEntry, onChange: (rule: RuleEntry) => void) => <RuleOptions rule={rule} onChange={onChange} /> };
  const prepend = { ...body, rules: draft.routing?.mode === 'bound' ? draft.routing.prependRules ?? [] : [] };
  return <>
    <ErrorAlert error={rulesets.error} />
    <TemplateRulesEditor {...props} value={body} onChange={update} selected={selected} onSelect={setSelected} report={draftIssues(body)} readOnly={bound} title={bound ? '模板规则' : '规则'} />
    {bound && <details className="rounded-[10px] border border-line bg-panel p-4"><summary className="cursor-pointer text-[13px] font-medium">本订阅的前置规则（{prepend.rules.length} 项）<span className="ml-2 font-normal text-ink-muted">可选，优先于模板匹配</span></summary><div className="mt-4">
      <TemplateRulesEditor {...props} value={prepend} onChange={next => { if (draft.routing?.mode === 'bound') setDraft({ ...draft, routing: { ...draft.routing, prependRules: next.rules } }); }} selected={extra} onSelect={setExtra} report={draftIssues(prepend)} title="前置规则" staticOnly hideFinal />
    </div></details>}
  </>;
}
