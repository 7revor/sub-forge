import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
import { type Matcher, type ReportItem, type RuleEntry } from '@sub-forge/core';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api, type RuleRepo } from '../../api.ts';
import { SortableList } from '../../components/SortableList.tsx';
import { targetLabel } from '../../components/pickers.tsx';
import { ruleToLine } from '../../components/rule.ts';
import { Button, Card, Empty, ErrorAlert, Field, FieldError, buttonClass, cx } from '../../components/ui.tsx';
import { RemoteRulePicker } from '../../components/RemoteRulePicker.tsx';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches, type RepositoryUrlMatch } from '../../hooks/useRepositoryUrlMatches.ts';
import { RuleSetPicker } from '../../components/RuleSetPicker.tsx';
import { RuleSourcePreview } from '../../components/RuleSourcePreview.tsx';
import { newId, type ConvertCtx, type NamedRef, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { RuleEditDialog, repositoryHintClass } from './RuleEditDialog.tsx';
import { applyRuleDraft } from './ruleDraft.ts';

const columns = 'grid grid-cols-[36px_minmax(0,1fr)_64px] items-center gap-x-2 sm:grid-cols-[36px_minmax(0,1fr)_16px_clamp(140px,14vw,200px)_64px]';

function RuleMatcher({ matcher, ctx, repos }: { matcher: Matcher; ctx: ConvertCtx; repos: NamedRef[] }) {
  const sourceClass = 'shrink-0 text-[12px] text-ink-muted';
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
          <span className="max-w-[25%] shrink-0 truncate font-mono text-ink-muted">{file.ref}</span><span className="hidden shrink-0 text-faint sm:inline">·</span>
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

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report, onRuleValidationReady, readOnly = false, saveHint = '保存模板后生效', title = '规则', hideFinal = false, staticOnly = false, renderTarget, renderOptions }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
  onRuleValidationReady: (id: string, ready: boolean) => void;
  readOnly?: boolean; saveHint?: string; title?: string; hideFinal?: boolean; staticOnly?: boolean;
  renderTarget?: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => ReactNode;
  renderOptions?: (rule: RuleEntry, onChange: (rule: RuleEntry) => void) => ReactNode;
}) {
  const [linkError, setLinkError] = useState<string>();
  const [linkingRule, setLinkingRule] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState<RuleEntry>();
  const currentValue = useRef(value);
  currentValue.current = value;
  const remoteUrls = readOnly ? [] : value.rules.flatMap(r => r.matcher.kind === 'ruleset' && r.matcher.remote ? [r.matcher.remote.url] : []);
  const repositoryMatches = useRepositoryUrlMatches(remoteUrls);
  const repositories = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), enabled: value.rules.some(r => r.matcher.kind === 'ruleset' && !!r.matcher.repository) });
  const repos = repositories.data?.repos ?? [];
  const [preview, setPreview] = useState<Matcher>();
  const rule = newRule?.id === selected ? newRule : value.rules.find(r => r.id === selected);
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map(r => r.id === rule.id ? rule : r) });
  const close = () => {
    setNewRule(undefined);
    onSelect(undefined);
  };
  const add = (matcher: Matcher) => {
    const id = newId('r');
    const next = { id, matcher, target: value.final };
    if (matcher.kind === 'rule') { setNewRule(next); onSelect(id); }
    else onChange({ ...value, rules: [...value.rules, next] });
  };
  const linkRepository = async (ruleId: string, url: string, match: RepositoryUrlMatch) => {
    if (readOnly) return;
    setLinkingRule(ruleId); setLinkError(undefined);
    try {
      const matcher = await resolveRepositoryUrlMatch(url, match);
      const latest = currentValue.current;
      const selected = latest.rules.find(r => r.id === ruleId);
      if (selected?.matcher.kind !== 'ruleset' || selected.matcher.remote?.url !== url) return;
      onChange(applyRuleDraft(latest, { ...selected, matcher }));
    } catch (error) { setLinkError(error instanceof Error ? error.message : String(error)); }
    finally { setLinkingRule(undefined); }
  };
  return <>
    <Card title={title} subtitle={`${value.rules.length} 条 · 自上而下匹配`} bodyClass="pb-1" actions={!readOnly && <>
      <Button size="sm" aria-label="添加静态规则" onClick={() => add({ kind: 'rule', rule: { type: 'RAW', text: '' } })}><Plus size={14} />静态规则</Button>
      {!staticOnly && <RemoteRulePicker label="远程链接" ariaLabel="引用远程链接" triggerClassName={buttonClass('default', 'sm')} onSelect={add} />}
      {!staticOnly && <Button size="sm" onClick={() => setAdding(true)}>引用规则</Button>}
    </>}>
      <ErrorAlert error={repositories.error} />
      <ErrorAlert error={repositoryMatches.error} />
      {linkError && <FieldError error={linkError} />}
      {!value.rules.length && <div className="px-4 pb-4"><Empty title="没有规则" description={hideFinal ? "先于模板规则匹配，仅影响本订阅。" : "未匹配的流量走 MATCH。"} /></div>}
      <SortableList items={value.rules} getKey={r => r.id} isLocked={() => readOnly} onReorder={rules => onChange({ ...value, rules })} renderItem={(r, i, handle) => {
        const error = report.some(item => item.level === 'error' && item.where === `rule:${r.id}`);
        return <div id={`template-rule-${r.id}`} className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-2.5 text-[13px] hover:bg-ground', error && 'bg-err-soft')}>
          <span className="flex items-center text-[12px] text-ink-muted">{handle}{i + 1}</span>
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label={`预览第 ${i + 1} 条规则`} onClick={() => setPreview(r.matcher)} className="min-w-0 cursor-pointer overflow-hidden text-left hover:text-brand"><RuleMatcher matcher={r.matcher} ctx={ctx} repos={repos} /></button>
            {!readOnly && r.matcher.kind === 'ruleset' && r.matcher.remote && repositoryMatches.matches[r.matcher.remote.url]?.map(match => <button key={`${match.repo}:${match.ref}:${match.path}`} type="button" className={repositoryHintClass} title={`匹配到仓库文件：${match.hint}`} disabled={!!linkingRule} onClick={() => void linkRepository(r.id, r.matcher.kind === 'ruleset' ? r.matcher.remote!.url : '', match)}>关联仓库文件</button>)}
          </div>
          <span aria-hidden="true" className="hidden text-faint sm:block">→</span>
          <div className="col-start-2 row-start-2 min-w-0 text-ink-2 sm:col-auto sm:row-auto [&_button[role=combobox]]:h-8 [&_button[role=combobox]]:min-w-0 [&_button[role=combobox]]:text-[12.5px]">
            {readOnly ? <span className="block truncate text-center" title={targetLabel(r.target, groupName, ref => ref.id)}>{targetLabel(r.target, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(r.target, target => update({ ...r, target }), `第 ${i + 1} 条规则出口`) : <TemplateTargetSelect label={`第 ${i + 1} 条规则出口`} value={r.target} groups={value.groups} onChange={target => update({ ...r, target })} />}
          </div>
          {!readOnly && <div className="col-start-3 row-start-1 flex gap-1 sm:col-start-5">
            <Button size="sm" variant="ghost" className="px-1.5" aria-label={`设置第 ${i + 1} 条规则`} onClick={() => onSelect(r.id)}><Pencil size={14} /></Button>
            <Button size="sm" variant="ghost" className="px-1.5 hover:text-err" aria-label={`删除第 ${i + 1} 条规则`} onClick={() => { onChange({ ...value, rules: value.rules.filter(item => item.id !== r.id) }); if (selected === r.id) onSelect(undefined); }}><Trash2 size={14} /></Button>
          </div>}
        </div>;
      }} />
      {!hideFinal && <div className={cx(columns, 'gap-y-1 border-t border-line-2 px-4 py-2.5 text-[13px]')}>
        <span className="pl-6 text-ink-muted">—</span><span className="font-mono text-[12.5px]">MATCH</span><span aria-hidden="true" className="hidden text-faint sm:block">→</span>
        <div id="template-rule-final" className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto [&_button[role=combobox]]:h-8 [&_button[role=combobox]]:min-w-0 [&_button[role=combobox]]:text-[12.5px]">
          {readOnly ? <span className="block truncate text-center" title={targetLabel(value.final, groupName, ref => ref.id)}>{targetLabel(value.final, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(value.final, final => onChange({ ...value, final }), 'MATCH 出口') : <TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={final => onChange({ ...value, final })} />}
        </div>
        <div className="col-span-full"><ItemIssues report={report} where="final" /></div>
      </div>}
    </Card>
    <Dialog open={adding} onOpenChange={next => { if (!next) (() => setAdding(false))(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{"引用规则"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      <Field label="规则来源">{id => <RuleSetPicker id={id} label="选择规则集合或增强集合" onSelect={matcher => { add(matcher); setAdding(false); }} />}</Field>
    </div><DialogFooter>{<Button onClick={() => setAdding(false)}>取消</Button>}</DialogFooter></DialogContent></Dialog>
    {!readOnly && rule && <RuleEditDialog key={rule.id} rule={rule} index={value.rules.indexOf(rule)} ctx={ctx} staticOnly={staticOnly} adding={newRule?.id === rule.id} saveHint={saveHint} renderOptions={renderOptions} onClose={close} onSave={draft => {
      onChange(applyRuleDraft(currentValue.current, draft, newRule?.id === draft.id));
      onRuleValidationReady(draft.id, true);
      close();
    }} />}
    <RuleSourcePreview matcher={preview} onClose={() => setPreview(undefined)} />
  </>;
}
