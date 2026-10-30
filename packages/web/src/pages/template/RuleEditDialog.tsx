import { localRulesError, remoteRuleMatcher, withIpOptions, type Matcher, type RuleEntry } from '@sub-forge/core';
import { useState, type ReactNode } from 'react';
import { clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { RuleEditShell } from '../../components/RuleEditShell.tsx';
import type { ConvertCtx } from '../../convert/templateYaml.ts';

/** 编辑只修改弹窗草稿；URL 检测由列表在新增或导入时显式触发。 */
export function RuleEditDialog({ rule, index, ctx, staticOnly, adding, renderOptions, onSave, onClose }: {
  rule: RuleEntry; index: number; ctx: ConvertCtx; staticOnly: boolean; adding: boolean;
  renderOptions?: (rule: RuleEntry, onChange: (rule: RuleEntry) => void) => ReactNode;
  onSave: (rule: RuleEntry) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(rule));
  const [attempted, setAttempted] = useState(false);
  const matcher = draft.matcher;
  let error: string | undefined;
  let normalized: Matcher = matcher;
  if (matcher.kind === 'local') error = localRulesError(matcher) ?? clientOverridesError(matcher.overrides ?? []);
  else if (matcher.kind === 'rule') error = ruleInputError(withIpOptions(matcher.rule, draft.options ?? {})) ?? clientOverridesError(matcher.overrides ?? []);
  else if (matcher.remote) {
    try { normalized = { ...matcher, ...remoteRuleMatcher(matcher.remote.url) }; }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  } else if (!matcher.id) error = '请选择规则集';
  return <RuleEditShell tall={matcher.kind !== 'ruleset'} title={adding ? '添加规则' : `编辑第 ${index + 1} 项规则`} description="编辑规则内容，出口在卡片中选择。"
    error={attempted ? error : undefined} onClose={onClose} onApply={() => { setAttempted(true); if (!error) onSave({ ...draft, matcher: normalized }); }}>
    <MatcherEditor directRemote fixedKind={staticOnly} value={matcher} rulesets={ctx.rulesets}
      ruleValue={matcher.kind === 'rule' ? withIpOptions(matcher.rule, draft.options ?? {}) : undefined}
      onRuleChange={rule => { if (matcher.kind === 'rule') setDraft({ ...draft, matcher: { ...matcher, rule } }); }}
      onChange={matcher => setDraft({ ...draft, matcher })} />
    {renderOptions && <div className="min-w-0 border-t border-line-2 pt-4">{renderOptions(draft, setDraft)}</div>}
  </RuleEditShell>;
}
