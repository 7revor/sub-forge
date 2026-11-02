import { RemoteRuleInput } from './RemoteRuleInput.tsx';
import { LocalRulesInput } from './LocalRulesInput.tsx';
import { ruleToLine } from './rule.ts';
import { remoteRuleMatcher, type Matcher, type RuleIR } from '@sub-forge/core';
import { changeMatcherKind } from '../domain/matcher.ts';
import { Field, Segmented } from './ui.tsx';
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
    {!fixedKind && <Segmented label="匹配类型" value={selectedKind} options={[{ value: 'ruleset', label: '系统规则集' }, { value: 'remote', label: '远程地址' }, { value: 'local', label: '本地规则' }]} onChange={changeKind} />}
    {value.kind === 'local' || value.kind === 'rule' ? <Field label="规则内容">{id => <LocalRulesInput id={id}
      value={value.kind === 'local' ? value.content : ruleToLine(ruleValue ?? value.rule)} onChange={content => onChange(value.kind === 'local' ? { ...value, content } : {
        kind: 'local', content, ...(value.overrides ? { overrides: value.overrides } : {}), ...(value.rule.type === 'RAW' && value.rule.client ? { client: value.rule.client } : {}),
      })} />}</Field>
      : value.remote ? <Field label="规则地址">{id => directRemote ? <RemoteRuleInput id={id} value={value.remote!.url} onChange={url => {
        let matcher: Matcher;
        try { matcher = { ...value, ...remoteRuleMatcher(url), remote: { url } }; }
        catch { matcher = { ...value, id: '', remote: { url } }; } // 保留无效输入，由弹窗显示校验错误。
        onChange(matcher);
      }} /> : <RemoteRulePicker id={id} value={value.remote!.url} label={value.remote!.url || '填写远程 URL'} onSelect={onChange} />}</Field>
      : <Field label="系统规则集">{(id) => <RuleSetPicker key={value.id} id={id} label="选择规则集" ariaLabel="系统规则集" placeholder="搜索并选择规则仓库文件或规则集合" modal={directRemote}
        valueLabel={value.id ? value.repository?.name ?? `规则集合 · ${rulesets.find(item => item.id === value.id)?.name ?? `${value.id}（当前不可用）`}` : undefined} onSelect={onChange} />}</Field>}
  </div>;
}
