import { localRulesError, remoteRuleMatcher, withIpOptions, type Matcher, type RuleEntry } from '@sub-forge/core';
import { createModal, useModalDraft } from '../../modals/index.tsx';
import { ClientOverrides } from '../../components/ClientOverrides.tsx';
import { clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { RuleEditShell } from '../../components/RuleEditShell.tsx';
import type { ConvertCtx } from '../../convert/templateYaml.ts';

/** 编辑只修改弹窗草稿；URL 检测由列表在新增或导入时显式触发。 */
export const RuleEditDialog = createModal<{ rule: RuleEntry; index: number; ctx: ConvertCtx; staticOnly: boolean; adding: boolean; extendedOptions?: boolean }, RuleEntry>(function RuleEdit({ data: { rule, index, ctx, staticOnly, adding, extendedOptions }, modal }) {
  const onSave = modal.confirm, onClose = modal.cancel;
  const [draft, setDraft] = useModalDraft(rule);
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
  return <RuleEditShell tall={matcher.kind !== 'ruleset'} title={adding ? '添加规则' : `编辑第 ${index + 1} 项规则`}
    error={attempted ? error : undefined} onClose={onClose} onApply={() => { setAttempted(true); if (!error) onSave({ ...draft, matcher: normalized }); }}>
    <MatcherEditor directRemote fixedKind={staticOnly} value={matcher} rulesets={ctx.rulesets}
      ruleValue={matcher.kind === 'rule' ? withIpOptions(matcher.rule, draft.options ?? {}) : undefined}
      onRuleChange={rule => { if (matcher.kind === 'rule') setDraft({ ...draft, matcher: { ...matcher, rule } }); }}
      onChange={matcher => setDraft({ ...draft, matcher })} />
    {extendedOptions && matcher.kind !== 'ruleset' && <div className="min-w-0 border-t border-line-2 pt-4"><details><summary className="cursor-pointer text-[13px]">客户端覆盖</summary><div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={overrides => setDraft({ ...draft, matcher: { ...matcher, overrides } })} /></div></details></div>}
  </RuleEditShell>;
});
