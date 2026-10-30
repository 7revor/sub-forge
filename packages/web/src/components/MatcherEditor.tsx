import { LocalRulesInput } from './LocalRulesInput.tsx';
import { ruleToLine } from './rule.ts';
import { remoteRuleMatcher, type Matcher, type RuleIR } from '@sub-forge/core';
import { changeMatcherKind } from '../domain/matcher.ts';
import { Field, Input, Select } from './ui.tsx';
import { RemoteRulePicker } from './RemoteRulePicker.tsx';
import { RuleSetPicker } from './RuleSetPicker.tsx';

export function MatcherEditor({ value, onChange, rulesets, ruleValue, onRuleChange, fixedKind = false, directRemote = false }: {
  value: Matcher; onChange: (matcher: Matcher) => void; rulesets: { id: string; name: string }[];
  /** 允许调用方适配历史规则字段；编辑器本身不迁移持久化数据。 */
  ruleValue?: RuleIR; onRuleChange?: (rule: RuleIR) => void;
  fixedKind?: boolean;
  directRemote?: boolean;
}) {
  const selectedKind = value.kind === 'ruleset' && value.remote ? 'remote' : value.kind === 'rule' ? 'local' : value.kind;
  const changeKind = (kind: string) => {
    if (kind === 'local') onChange({ kind: 'local', content: '' });
    else if (kind === 'remote') onChange({ kind: 'ruleset', id: '', remote: { url: '' } });
    else if (kind === 'ruleset' && selectedKind === 'remote') onChange({ kind: 'ruleset', id: '' });
    else onChange(changeMatcherKind(value, kind as Matcher['kind']));
  };
  return <div className="flex min-w-0 flex-col gap-4 [&>*]:min-w-0">
    {!fixedKind && <Field label="匹配类型">{(id) => <Select placeholder="选择本地规则、规则集或远程规则来源" id={id} value={selectedKind} className="text-[13px]" onChange={(event) => changeKind(event.target.value)}>
      <option value="local">本地规则</option><option value="ruleset">系统规则集</option><option value="remote">远程 URL</option>
    </Select>}</Field>}
    {value.kind === 'local' || value.kind === 'rule' ? <Field label="本地规则" hint="每行一条，同一卡片共用出口，按输入顺序执行。">{id => <LocalRulesInput id={id}
      value={value.kind === 'local' ? value.content : ruleToLine(ruleValue ?? value.rule)} onChange={content => onChange(value.kind === 'local' ? { ...value, content } : {
        kind: 'local', content, ...(value.overrides ? { overrides: value.overrides } : {}), ...(value.rule.type === 'RAW' && value.rule.client ? { client: value.rule.client } : {}),
      })} />}</Field>
      : value.remote ? <Field label="规则地址">{id => directRemote ? <Input id={id} type="url" className="min-w-0 font-mono" spellCheck={false} value={value.remote!.url} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" onChange={event => {
        const url = event.target.value;
        let matcher: Matcher;
        try { matcher = { ...value, ...remoteRuleMatcher(url), remote: { url } }; }
        catch { matcher = { ...value, id: '', remote: { url } }; } // 保留无效输入，由弹窗显示校验错误。
        onChange(matcher);
      }} /> : <RemoteRulePicker id={id} value={value.remote!.url} label={value.remote!.url || '填写远程 URL'} onSelect={onChange} />}</Field>
      : <Field label="系统规则集">{(id) => <RuleSetPicker key={value.id} id={id} label="选择规则集" ariaLabel="系统规则集" placeholder="选择规则集" modal={directRemote}
        valueLabel={value.id ? value.repository?.name ?? `本地 · ${rulesets.find(item => item.id === value.id)?.name ?? `${value.id}（当前不可用）`}` : undefined} onSelect={onChange} />}</Field>}
  </div>;
}
