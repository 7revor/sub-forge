import { remoteRuleMatcher, withIpOptions, type Matcher, type ReportItem, type RuleEntry, type RuleIR } from '@sub-forge/core';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { targetLabel } from '../../components/pickers.tsx';
import { Button, Card, Empty, Field, FieldError, Input, Modal, buttonClass, cx } from '../../components/ui.tsx';
import { RemoteRulePicker } from '../../components/RemoteRulePicker.tsx';
import { RuleSetPicker } from '../../components/RuleSetPicker.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, matcherLabel, TemplateTargetSelect } from './TemplateFields.tsx';

const columns = 'grid grid-cols-[44px_minmax(0,1fr)_64px] items-center gap-x-2 sm:grid-cols-[44px_minmax(0,1.4fr)_16px_minmax(0,0.8fr)_64px]';

function RuleMatcher({ matcher, ctx }: { matcher: Matcher; ctx: ConvertCtx }) {
  if (matcher.kind === 'ruleset' && matcher.remote) return <span className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
    <span className="shrink-0">远程 ·</span>
    <span dir="rtl" title={matcher.remote.url} className="truncate text-left"><bdi dir="ltr">{matcher.remote.url}</bdi></span>
  </span>;
  const label = matcherLabel(matcher, ctx);
  return <span className="block truncate font-mono text-[12.5px]" title={label}>{label || '填写规则内容'}</span>;
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
}) {
  const [urlError, setUrlError] = useState<string>();
  const rule = value.rules.find(r => r.id === selected);
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map(r => r.id === rule.id ? rule : r) });
  const add = (matcher: Matcher) => {
    const id = newId('r');
    onChange({ ...value, rules: [...value.rules, { id, matcher, target: value.final }] });
    if (matcher.kind === 'rule') onSelect(id);
  };
  const changeRule = (next: RuleIR) => {
    if (rule?.matcher.kind !== 'rule') return;
    const { noResolve: _noResolve, src: _src, ...options } = rule.options ?? {};
    update({ ...rule, matcher: { ...rule.matcher, rule: next }, ...(rule.options ? { options } : {}) });
  };
  return <>
    <Card title="规则" subtitle={`${value.rules.length} 条 · 自上而下匹配`} bodyClass="pb-1" actions={<>
      <Button size="sm" aria-label="添加单条规则" onClick={() => add({ kind: 'rule', rule: { type: 'RAW', text: '' } })}><Plus size={14} />单条规则</Button>
      <RemoteRulePicker label="远程 URL" ariaLabel="引用远程 URL" triggerClassName={buttonClass('default', 'sm')} onSelect={add} />
      <RuleSetPicker label="系统规则集" ariaLabel="引用系统规则集" onSelect={add} triggerClassName={buttonClass('default', 'sm')} />
    </>}>
      {!value.rules.length && <div className="px-4 pb-4"><Empty title="没有规则" description="未匹配的流量走 MATCH。" /></div>}
      <SortableList items={value.rules} getKey={r => r.id} onReorder={rules => onChange({ ...value, rules })} renderItem={(r, i, handle) => {
        const error = report.some(item => item.level === 'error' && item.where === `rule:${r.id}`);
        return <div id={`template-rule-${r.id}`} className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-1 text-[13px] hover:bg-ground', error && 'bg-err-soft')}>
          <span className="flex items-center text-[12px] text-muted">{handle}{i + 1}</span>
          <button type="button" aria-label={`编辑第 ${i + 1} 条规则`} onClick={() => onSelect(r.id)} className="min-w-0 cursor-pointer text-left hover:text-accent"><RuleMatcher matcher={r.matcher} ctx={ctx} /></button>
          <span aria-hidden="true" className="hidden text-faint sm:block">→</span>
          <button type="button" aria-label={`修改第 ${i + 1} 条规则出口`} onClick={() => onSelect(r.id)} className="col-start-2 row-start-2 min-w-0 cursor-pointer truncate text-left text-ink-2 hover:text-accent sm:col-auto sm:row-auto">{targetLabel(r.target, groupName, ref => ref.id)}</button>
          <div className="col-start-3 row-start-1 flex gap-1 sm:col-start-5">
            <Button size="sm" variant="ghost" className="px-1.5" aria-label={`设置第 ${i + 1} 条规则`} onClick={() => onSelect(r.id)}><Pencil size={14} /></Button>
            <Button size="sm" variant="ghost" className="px-1.5 hover:text-err" aria-label={`删除第 ${i + 1} 条规则`} onClick={() => { onChange({ ...value, rules: value.rules.filter(item => item.id !== r.id) }); if (selected === r.id) onSelect(undefined); }}><Trash2 size={14} /></Button>
          </div>
        </div>;
      }} />
      <div className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-3 text-[13px]')}>
        <span className="pl-6 text-muted">—</span><span className="font-mono text-[12.5px]">MATCH</span><span aria-hidden="true" className="hidden text-faint sm:block">→</span>
        <button type="button" aria-label="修改 MATCH 出口" onClick={() => onSelect('final')} className="col-start-2 row-start-2 cursor-pointer truncate text-left hover:text-accent sm:col-auto sm:row-auto">{targetLabel(value.final, groupName, ref => ref.id)}</button>
        <Button size="sm" variant="ghost" className="col-start-3 row-start-1 justify-self-start px-1.5 sm:col-start-5" aria-label="编辑 MATCH" onClick={() => onSelect('final')}><Pencil size={14} /></Button>
      </div>
    </Card>
    <Modal title={rule ? `编辑第 ${value.rules.indexOf(rule) + 1} 条规则` : 'MATCH 出口'} open={!!rule || selected === 'final'} onClose={() => onSelect(undefined)} wide
      footer={<><span className="mr-auto self-center text-[12px] text-muted">保存模板后生效</span><Button variant="primary" onClick={() => onSelect(undefined)}>完成</Button></>}>
      {rule ? <>
        <ItemIssues report={report} where={`rule:${rule.id}`} />
        {rule.matcher.kind === 'ruleset' && rule.matcher.remote ? <Field label="远程规则地址">{id => <Input id={id} type="url" value={rule.matcher.kind === 'ruleset' ? rule.matcher.remote!.url : ''} onChange={e => {
          const url = e.target.value;
          let matcher: Matcher;
          try { matcher = remoteRuleMatcher(url); setUrlError(undefined); }
          catch (error) {
            matcher = { kind: 'ruleset', id: '', remote: { url } };
            setUrlError(error instanceof Error ? error.message : String(error));
          }
          update({ ...rule, matcher });
        }} />}</Field> : <MatcherEditor fixedKind value={rule.matcher} rulesets={ctx.rulesets} ruleValue={rule.matcher.kind === 'rule' ? withIpOptions(rule.matcher.rule, rule.options ?? {}) : undefined} onRuleChange={changeRule} onChange={matcher => update({ ...rule, matcher })} />}
        {rule.matcher.kind === 'ruleset' && rule.matcher.remote && !rule.matcher.id && urlError && <FieldError error={urlError} />}
        <Field label="出口">{() => <TemplateTargetSelect label="规则出口" value={rule.target} groups={value.groups} onChange={target => update({ ...rule, target })} />}</Field>
      </> : <>
        <span className="text-[13px] text-muted">以上规则均未匹配时使用。</span>
        <TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={final => onChange({ ...value, final })} />
        <ItemIssues report={report} where="final" />
      </>}
    </Modal>
  </>;
}
