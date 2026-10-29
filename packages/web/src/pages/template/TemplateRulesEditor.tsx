import { remoteRuleMatcher, withIpOptions, type Matcher, type ReportItem, type RuleEntry, type RuleIR } from '@sub-forge/core';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type RuleRepo } from '../../api.ts';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { targetLabel } from '../../components/pickers.tsx';
import { ruleToLine } from '../../components/rule.ts';
import { Button, Card, Empty, ErrorAlert, Field, FieldError, Input, Modal, buttonClass, cx } from '../../components/ui.tsx';
import { RemoteRulePicker } from '../../components/RemoteRulePicker.tsx';
import { RuleSetPicker } from '../../components/RuleSetPicker.tsx';
import { RuleSourcePreview } from '../../components/RuleSourcePreview.tsx';
import { newId, type ConvertCtx, type NamedRef, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';

const columns = 'grid grid-cols-[44px_minmax(0,1fr)_64px] items-center gap-x-2 sm:grid-cols-[44px_minmax(0,1fr)_16px_clamp(100px,10vw,140px)_64px]';

function RuleMatcher({ matcher, ctx, repos }: { matcher: Matcher; ctx: ConvertCtx; repos: NamedRef[] }) {
  const sourceClass = 'shrink-0 text-[12px] text-muted';
  const lineClass = 'flex min-w-0 items-center gap-2 text-[12.5px]';
  if (matcher.kind === 'rule') {
    const line = ruleToLine(matcher.rule);
    return <span className={lineClass}><span className={sourceClass}>静态规则 ·</span><span className="min-w-0 truncate font-mono" title={line}>{line || '填写规则内容'}</span></span>;
  }
  if (matcher.repository) {
    const repository = matcher.repository;
    const name = repos.find(repo => repo.id === repository.repo)?.name ?? repository.repo;
    return <span className={cx(lineClass, 'flex-wrap gap-y-1 sm:flex-nowrap')}>
      <span className={sourceClass}>规则集合 ·</span>
      <span className="flex min-w-0 flex-1 basis-full flex-col gap-1 sm:basis-auto">{repository.sources.map(source => {
        const file = source.repository!;
        return <span key={source.id} className={cx(lineClass, 'flex-wrap gap-y-1 sm:flex-nowrap')} title={`${name} · ${file.ref} · ${file.path}`}>
          <span className="max-w-[60%] shrink-0 truncate sm:max-w-[35%]">{name}</span><span className="shrink-0 text-faint">·</span>
          <span className="max-w-[25%] shrink-0 truncate font-mono text-muted">{file.ref}</span><span className="hidden shrink-0 text-faint sm:inline">·</span>
          <span dir="rtl" className="min-w-0 basis-full truncate text-left font-mono sm:basis-auto"><bdi dir="ltr">{file.path}</bdi></span>
        </span>;
      })}</span>
    </span>;
  }
  if (matcher.remote) return <span className={lineClass}>
    <span className={sourceClass}>远程链接 ·</span>
    <span dir="rtl" title={matcher.remote.url} className="min-w-0 truncate text-left font-mono"><bdi dir="ltr">{matcher.remote.url}</bdi></span>
  </span>;
  const name = ctx.rulesets.find(r => r.id === matcher.id)?.name ?? (matcher.id || '未选择');
  return <span className={lineClass}><span className={sourceClass}>增强集合 ·</span><span className="truncate" title={name}>{name}</span></span>;
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report, onRuleValidationReady }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
  onRuleValidationReady: (id: string, ready: boolean) => void;
}) {
  const [urlError, setUrlError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const repositories = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), enabled: value.rules.some(r => r.matcher.kind === 'ruleset' && !!r.matcher.repository) });
  const repos = repositories.data?.repos ?? [];
  const [preview, setPreview] = useState<Matcher>();
  const rule = value.rules.find(r => r.id === selected);
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map(r => r.id === rule.id ? rule : r) });
  const close = () => {
    if (rule) onRuleValidationReady(rule.id, true);
    onSelect(undefined);
  };
  const add = (matcher: Matcher) => {
    const id = newId('r');
    if (matcher.kind === 'rule') onRuleValidationReady(id, false);
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
      <Button size="sm" aria-label="添加静态规则" onClick={() => add({ kind: 'rule', rule: { type: 'RAW', text: '' } })}><Plus size={14} />静态规则</Button>
      <RemoteRulePicker label="远程链接" ariaLabel="引用远程链接" triggerClassName={buttonClass('default', 'sm')} onSelect={add} />
      <Button size="sm" onClick={() => setAdding(true)}>引用规则</Button>
    </>}>
      <ErrorAlert error={repositories.error} />
      {!value.rules.length && <div className="px-4 pb-4"><Empty title="没有规则" description="未匹配的流量走 MATCH。" /></div>}
      <SortableList items={value.rules} getKey={r => r.id} onReorder={rules => onChange({ ...value, rules })} renderItem={(r, i, handle) => {
        const error = report.some(item => item.level === 'error' && item.where === `rule:${r.id}`);
        return <div id={`template-rule-${r.id}`} className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-2.5 text-[13px] hover:bg-ground', error && 'bg-err-soft')}>
          <span className="flex items-center text-[12px] text-muted">{handle}{i + 1}</span>
          <button type="button" aria-label={`预览第 ${i + 1} 条规则`} onClick={() => setPreview(r.matcher)} className="min-w-0 cursor-pointer text-left hover:text-accent"><RuleMatcher matcher={r.matcher} ctx={ctx} repos={repos} /></button>
          <span aria-hidden="true" className="hidden text-faint sm:block">→</span>
          <span title={targetLabel(r.target, groupName, ref => ref.id)} className="col-start-2 row-start-2 min-w-0 truncate text-center text-ink-2 sm:col-auto sm:row-auto">{targetLabel(r.target, groupName, ref => ref.id)}</span>
          <div className="col-start-3 row-start-1 flex gap-1 sm:col-start-5">
            <Button size="sm" variant="ghost" className="px-1.5" aria-label={`设置第 ${i + 1} 条规则`} onClick={() => onSelect(r.id)}><Pencil size={14} /></Button>
            <Button size="sm" variant="ghost" className="px-1.5 hover:text-err" aria-label={`删除第 ${i + 1} 条规则`} onClick={() => { onChange({ ...value, rules: value.rules.filter(item => item.id !== r.id) }); if (selected === r.id) onSelect(undefined); }}><Trash2 size={14} /></Button>
          </div>
        </div>;
      }} />
      <div className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-2.5 text-[13px]')}>
        <span className="pl-6 text-muted">—</span><span className="font-mono text-[12.5px]">MATCH</span><span aria-hidden="true" className="hidden text-faint sm:block">→</span>
        <span title={targetLabel(value.final, groupName, ref => ref.id)} className="col-start-2 row-start-2 min-w-0 truncate text-center sm:col-auto sm:row-auto">{targetLabel(value.final, groupName, ref => ref.id)}</span>
        <Button size="sm" variant="ghost" className="col-start-3 row-start-1 justify-self-start px-1.5 sm:col-start-5" aria-label="编辑 MATCH" onClick={() => onSelect('final')}><Pencil size={14} /></Button>
      </div>
    </Card>
    <Modal title="引用规则" open={adding} onClose={() => setAdding(false)} wide footer={<Button onClick={() => setAdding(false)}>取消</Button>}>
      <Field label="规则来源">{id => <RuleSetPicker id={id} label="选择规则集合或增强集合" onSelect={matcher => { add(matcher); setAdding(false); }} />}</Field>
    </Modal>
    <Modal title={rule ? `编辑第 ${value.rules.indexOf(rule) + 1} 条规则` : 'MATCH 出口'} open={!!rule || selected === 'final'} onClose={close} wide
      footer={<><span className="mr-auto self-center text-[12px] text-muted">保存模板后生效</span><Button variant="primary" onClick={close}>完成</Button></>}>
      {rule ? <>
        <ItemIssues report={report} where={`rule:${rule.id}`} />
        {rule.matcher.kind === 'ruleset' && rule.matcher.remote ? <Field label="远程链接">{id => <Input id={id} type="url" value={rule.matcher.kind === 'ruleset' ? rule.matcher.remote!.url : ''} onChange={e => {
          const url = e.target.value;
          let matcher: Matcher;
          try { matcher = remoteRuleMatcher(url); setUrlError(undefined); }
          catch (error) {
            matcher = { kind: 'ruleset', id: '', remote: { url } };
            setUrlError(error instanceof Error ? error.message : String(error));
          }
          update({ ...rule, matcher });
        }} />}</Field> : rule.matcher.kind === 'ruleset' ? <Field label="规则来源">{id => <>
          <RuleMatcher matcher={rule.matcher} ctx={ctx} repos={repos} />
          <RuleSetPicker id={id} label="更换规则来源" onSelect={matcher => update({ ...rule, matcher })} />
        </>}</Field> : <div className="contents" onBlur={() => onRuleValidationReady(rule.id, true)}><MatcherEditor fixedKind value={rule.matcher} rulesets={ctx.rulesets} ruleValue={withIpOptions(rule.matcher.rule, rule.options ?? {})} onRuleChange={changeRule} onChange={matcher => update({ ...rule, matcher })} /></div>}
        {rule.matcher.kind === 'ruleset' && rule.matcher.remote && !rule.matcher.id && urlError && <FieldError error={urlError} />}
        <Field label="出口">{() => <TemplateTargetSelect label="规则出口" value={rule.target} groups={value.groups} onChange={target => update({ ...rule, target })} />}</Field>
      </> : <>
        <span className="text-[13px] text-muted">以上规则均未匹配时使用。</span>
        <TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={final => onChange({ ...value, final })} />
        <ItemIssues report={report} where="final" />
      </>}
    </Modal>
    {preview && <RuleSourcePreview matcher={preview} onClose={() => setPreview(undefined)} />}
  </>;
}
