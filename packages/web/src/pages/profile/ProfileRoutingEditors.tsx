// 订阅与模板使用同一套列表和弹窗；订阅补充节点成员与独立规则出口。
import type { GroupSpec, RuleEntry } from '@sub-forge/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { ClientOverrides } from '../../components/ClientOverrides.tsx';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { RuleTargetSelect } from '../../components/RuleTargetSelect.tsx';
import { Badge, Button, Empty, ErrorAlert, Field, Input, Switch } from '../../components/ui.tsx';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { useRuleSetRefs } from '../../hooks.ts';
import { TemplateGroupsEditor } from '../template/TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from '../template/TemplateRulesEditor.tsx';
import { draftIssues } from '../template/model.ts';
import { useProfile } from './context.ts';
import { MemberAdder } from './MemberAdder.tsx';

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

function GroupMembers({ group }: { group: GroupSpec }) {
  const { draft, setDraft, groupName, nodeSetName } = useProfile();
  const routing = draft.routing!;
  const bound = routing.mode === 'bound';
  const members = bound ? routing.groupAdditions[group.id] ?? [] : group.members;
  const inherited = bound ? group.members : [];
  const setMembers = (members: GroupSpec['members']) => setDraft({ ...draft, routing: routing.mode === 'bound'
    ? { ...routing, groupAdditions: { ...routing.groupAdditions, [group.id]: members } }
    : { ...routing, config: { ...routing.config, groups: routing.config.groups.map(g => g.id === group.id ? { ...g, members } : g) } } });
  const refs = [...new Map([...inherited, ...members].flatMap(m => m.kind === 'nodeset' ? [[`${m.ref.type}:${m.ref.id}`, m.ref] as const] : [])).values()];
  return <section className="flex min-w-0 flex-col gap-3" aria-label="策略组成员">
    {inherited.length > 0 && <div className="flex flex-col gap-2"><span className="text-[12px] text-ink-muted">模板成员</span>{inherited.map((m, i) => <div key={i} className="flex items-center gap-2 text-[13px]"><Badge>模板</Badge>{memberLabel(m, groupName, nodeSetName).text}</div>)}</div>}
    <h3 className="m-0 text-[14px] font-semibold">{bound ? '本订阅填充' : '成员与节点填充'}</h3>
    {bound && <p className="m-0 text-[12.5px] text-ink-muted">追加在模板成员之后，仅影响本订阅。</p>}
    {members.length ? <div className="rounded-lg border border-line px-3"><SortableList items={members} onReorder={setMembers} renderItem={(m, i, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
      {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, nodeSetName).text}</span>
      <Button size="sm" aria-label={`移除 ${memberLabel(m, groupName, nodeSetName).text}`} onClick={() => setMembers(members.filter((_, j) => i !== j))}>移除</Button>
    </div>} /></div> : <Empty title={bound ? '尚未填充节点' : '还没有成员'} />}
    <MemberAdder key={group.id} excludeGroupId={group.id} onAdd={m => setMembers([...members, m])} />
    {refs.map(ref => <div key={`${ref.type}:${ref.id}`} className="flex flex-col gap-2"><span className="text-[12px] text-ink-muted">{nodeSetName(ref)}</span><MatchPreview nodeSet={ref} filter={group.filter} excludeFilter={group.excludeFilter} excludeType={group.excludeType} /></div>)}
    {!bound && <details className="text-[13px]"><summary className="cursor-pointer text-ink-muted">更多组设置</summary><div className="mt-3 flex flex-col gap-3">
      <Field label="图标地址">{id => <Input id={id} value={group.display?.icon ?? ''} onChange={e => { if (routing.mode === 'independent') setDraft({ ...draft, routing: { ...routing, config: { ...routing.config, groups: routing.config.groups.map(g => g.id === group.id ? { ...g, display: { ...g.display, icon: e.target.value || undefined } } : g) } } }); }} />}</Field>
      <ExtraFields value={group.extra ?? {}} validateName={name => name === 'empty-fallback' ? '空组固定使用 REJECT' : undefined} onChange={extra => { if (routing.mode === 'independent') setDraft({ ...draft, routing: { ...routing, config: { ...routing.config, groups: routing.config.groups.map(g => g.id === group.id ? { ...g, extra } : g) } } }); }} />
    </div></details>}
  </section>;
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
      }} renderMembers={group => <GroupMembers group={group} />} />
  </>;
}

function RuleOptions({ rule, onChange }: { rule: RuleEntry; onChange: (rule: RuleEntry) => void }) {
  const matcher = rule.matcher;
  return matcher.kind === 'rule' ? <details><summary className="cursor-pointer text-[13px]">客户端覆盖</summary><div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={overrides => onChange({ ...rule, matcher: { ...matcher, overrides } })} /></div></details>
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
    {bound && <details className="rounded-[10px] border border-line bg-panel p-4"><summary className="cursor-pointer text-[13px] font-medium">本订阅的前置规则（{prepend.rules.length} 条）<span className="ml-2 font-normal text-ink-muted">可选，优先于模板匹配</span></summary><div className="mt-4">
      <TemplateRulesEditor {...props} value={prepend} onChange={next => { if (draft.routing?.mode === 'bound') setDraft({ ...draft, routing: { ...draft.routing, prependRules: next.rules } }); }} selected={extra} onSelect={setExtra} report={draftIssues(prepend)} title="前置规则" staticOnly hideFinal />
    </div></details>}
  </>;
}
