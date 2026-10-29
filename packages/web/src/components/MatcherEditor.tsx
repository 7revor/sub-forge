import type { Matcher, RuleIR } from '@sub-forge/core';
import { changeMatcherKind } from '../domain/matcher.ts';
import { RuleEditor } from './RuleEditor.tsx';
import { Field, Select } from './ui.tsx';

export function MatcherEditor({ value, onChange, rulesets, ruleValue, onRuleChange }: {
  value: Matcher; onChange: (matcher: Matcher) => void; rulesets: { id: string; name: string }[];
  /** 允许调用方适配历史规则字段；编辑器本身不迁移持久化数据。 */
  ruleValue?: RuleIR; onRuleChange?: (rule: RuleIR) => void;
}) {
  const changeRule = (rule: RuleIR) => {
    if (value.kind !== 'rule') return;
    if (onRuleChange) onRuleChange(rule);
    else onChange({ ...value, rule });
  };
  return <>
    <Field label="匹配项类型">{(id) => <Select id={id} value={value.kind} onChange={(event) => onChange(changeMatcherKind(value, event.target.value as Matcher['kind']))}>
      <option value="rule">单条规则</option><option value="ruleset">规则集</option>
    </Select>}</Field>
    {value.kind === 'rule' ? <RuleEditor value={ruleValue ?? value.rule} onChange={changeRule} onIncomplete={changeRule} />
      : <Field label="规则集">{(id) => <Select id={id} value={value.id} onChange={(event) => onChange({ ...value, id: event.target.value })}>
        <option value="">请选择</option>
        {value.id && !rulesets.some((item) => item.id === value.id) && <option value={value.id}>{value.id}（当前不可用）</option>}
        {rulesets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>}</Field>}
  </>;
}
