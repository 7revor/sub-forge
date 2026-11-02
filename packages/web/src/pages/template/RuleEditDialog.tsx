import type { GroupSpec } from '@sub-forge/core';
import { Field, Segmented } from '../../components/ui.tsx';
import { TemplateTargetSelect } from './TemplateFields.tsx';
import { localRulesError, remoteRuleMatcher, withIpOptions, type Matcher, type RuleEntry } from '@sub-forge/core';
import { createModal, useModalDraft } from '../../modals/index.tsx';
import { ClientOverrides } from '../../components/ClientOverrides.tsx';
import { clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { RuleEditShell } from '../../components/RuleEditShell.tsx';
import type { ConvertCtx } from '../../convert/templateYaml.ts';

/** 编辑只修改弹窗草稿；URL 检测由列表在新增或导入时显式触发。 */
export const RuleEditDialog = createModal<{ rule: RuleEntry; index: number; ctx: ConvertCtx; staticOnly: boolean; adding: boolean; extendedOptions?: boolean; groups?: GroupSpec[]; scope?: 'repository' | 'local'; bound?: boolean }, { rule: RuleEntry; position: 'before' | 'after' }>(function RuleEdit({ data: { rule, index, ctx, staticOnly, adding, extendedOptions, groups = [], scope, bound }, modal }) {
  const onSave = modal.confirm, onClose = modal.cancel;
  const [draft, setDraft] = useModalDraft(rule);
  const [position, setPosition] = useModalDraft<'before' | 'after'>('before');
  const [attempted, setAttempted] = useModalDraft(false);
  const matcher = draft.matcher;
  let error: string | undefined;
  let normalized: Matcher = matcher;
  if (matcher.kind === 'local') error = localRulesError(matcher) ?? clientOverridesError(matcher.overrides ?? []);
  else if (matcher.kind === 'rule') error = ruleInputError(withIpOptions(matcher.rule, draft.options ?? {})) ?? clientOverridesError(matcher.overrides ?? []);
  else if (matcher.remote) {
    try { normalized = { ...matcher, ...remoteRuleMatcher(matcher.remote.url) }; }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  } else if (!matcher.id) error = '请选择规则集';
  return <RuleEditShell description={adding && bound ? '插入本订阅的前置规则' : undefined} width={matcher.kind === 'ruleset' ? 440 : 520} confirmLabel={adding ? '添加' : '保存'} title={adding ? `添加规则 · ${matcher.kind !== 'ruleset' ? '手写' : matcher.remote ? '远程地址' : '引用规则'}` : `编辑第 ${index + 1} 项规则`}
    error={attempted ? error : undefined} onClose={onClose} onApply={() => { setAttempted(true); if (!error) onSave({ rule: { ...draft, matcher: normalized }, position }); }}>
    <MatcherEditor directRemote fixedKind scope={scope} value={matcher} rulesets={ctx.rulesets}
      ruleValue={matcher.kind === 'rule' ? withIpOptions(matcher.rule, draft.options ?? {}) : undefined}
      onRuleChange={rule => { if (matcher.kind === 'rule') setDraft({ ...draft, matcher: { ...matcher, rule } }); }}
      onChange={matcher => setDraft({ ...draft, matcher })} />
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><Field label="出口">{id => <div id={id} className="h-9 rounded-lg border border-input [&_button]:h-[34px]"><TemplateTargetSelect label="规则出口" value={draft.target} groups={groups} onChange={target => setDraft({ ...draft, target })} /></div>}</Field>{adding && bound && <Field label="位置">{id => <div id={id}><Segmented label="插入位置" value={position} onChange={setPosition} options={[{ value: 'before', label: '模板规则之前' }, { value: 'after', label: '之后' }]} /></div>}</Field>}</div>
    {extendedOptions && matcher.kind !== 'ruleset' && <div className="min-w-0 border-t border-border pt-4"><details><summary className="advanced-summary cursor-pointer text-sm"><span>按客户端改写<span className="mt-0.5 block text-xs font-normal text-muted-foreground">某个内核不支持时替换或跳过 · {matcher.overrides?.length ?? 0} 条</span></span></summary><div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={overrides => setDraft({ ...draft, matcher: { ...matcher, overrides } })} /></div></details></div>}
  </RuleEditShell>;
});
