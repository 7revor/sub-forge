import type { Matcher, RuleIR } from '@sub-forge/core';
import { changeMatcherKind } from '../domain/matcher.ts';
import { RuleEditor } from './RuleEditor.tsx';
import { Field, Select } from './ui.tsx';
import { RemoteRulePicker } from './RemoteRulePicker.tsx';
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
  const selectedKind = value.kind === 'ruleset' && value.remote ? 'remote' : value.kind;
  const changeKind = (kind: string) => {
    if (kind === 'remote') onChange({ kind: 'ruleset', id: '', remote: { url: '' } });
    else if (kind === 'ruleset' && selectedKind === 'remote') onChange({ kind: 'ruleset', id: '' });
    else onChange(changeMatcherKind(value, kind as Matcher['kind']));
  };
  return <>
    {!fixedKind && <Field label="匹配项类型">{(id) => <Select id={id} value={selectedKind} onChange={(event) => changeKind(event.target.value)}>
      <option value="rule">静态规则</option><option value="ruleset">系统规则集</option><option value="remote">远程 URL</option>
    </Select>}</Field>}
    {value.kind === 'rule' ? <RuleEditor value={ruleValue ?? value.rule} onChange={changeRule} />
      : value.remote ? <Field label="远程 URL">{id => <RemoteRulePicker id={id} value={value.remote!.url} label={value.remote!.url || '填写远程 URL'} onSelect={onChange} />}</Field>
      : <Field label="系统规则集">{(id) => <>
        {value.id && <span className="break-all text-[13px]">{value.repository?.name ?? `本地 · ${rulesets.find(item => item.id === value.id)?.name ?? `${value.id}（当前不可用）`}`}</span>}
        <RuleSetPicker key={value.id} id={id} label={value.id ? '更换规则集' : '选择规则集'} onSelect={onChange} />
      </>}</Field>}
  </>;
}
