import type { Matcher, RuleIR } from '@sub-forge/core';
import { changeMatcherKind } from '../domain/matcher.ts';
import { RuleEditor } from './RuleEditor.tsx';
import { Field, Select } from './ui.tsx';
import { RuleSetPicker } from './RuleSetPicker.tsx';

export function MatcherEditor({ value, onChange, rulesets, ruleValue, onRuleChange, fixedKind = false }: {
  value: Matcher; onChange: (matcher: Matcher) => void; rulesets: { id: string; name: string }[];
  /** 允许调用方适配历史规则字段；编辑器本身不迁移持久化数据。 */
  ruleValue?: RuleIR; onRuleChange?: (rule: RuleIR) => void;
  fixedKind?: boolean;
}) {
  const changeRule = (rule: RuleIR) => {
    if (value.kind !== 'rule') return;
    if (onRuleChange) onRuleChange(rule);
    else onChange({ ...value, rule });
  };
  return <>
    {!fixedKind && <Field label="匹配项类型">{(id) => <Select id={id} value={value.kind} onChange={(event) => onChange(changeMatcherKind(value, event.target.value as Matcher['kind']))}>
      <option value="rule">单条规则</option><option value="ruleset">规则集</option>
    </Select>}</Field>}
    {value.kind === 'rule' ? <RuleEditor value={ruleValue ?? value.rule} onChange={changeRule} onIncomplete={changeRule} />
      : <Field label="规则集">{(id) => <>
        {value.id && <span className="break-all text-[13px]">{value.repository?.name ?? `本地 · ${rulesets.find(item => item.id === value.id)?.name ?? `${value.id}（当前不可用）`}`}</span>}
        <RuleSetPicker key={value.id} id={id} label={value.id ? '更换规则集' : '选择规则集'} onSelect={onChange} />
      </>}</Field>}
  </>;
}
