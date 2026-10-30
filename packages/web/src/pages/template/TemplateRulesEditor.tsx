import { type Matcher, type ReportItem, type RuleEntry, localRuleLines } from '@sub-forge/core';
import { FileText, Globe, Link2, Plus, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SortableList } from '../../components/SortableList.tsx';
import { targetLabel } from '../../components/pickers.tsx';
import { ruleToLine } from '../../components/rule.ts';
import { Badge, Button, Card, Empty, ErrorAlert, FieldError } from '../../components/ui.tsx';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches, type RepositoryUrlMatch } from '../../hooks/useRepositoryUrlMatches.ts';
import { RuleSourcePreview } from '../../components/RuleSourcePreview.tsx';
import { RuleCard } from '../../components/RuleCard.tsx';
import { RepositoryMatchHint } from '../../components/RepositoryMatchHint.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { RuleEditDialog } from './RuleEditDialog.tsx';
import { applyRuleDraft } from './ruleDraft.ts';

export function ruleMatcherLabel(matcher: Matcher, ctx: ConvertCtx) {
  if (matcher.kind === 'local') return `本地规则 · ${localRuleLines(matcher.content)[0]?.text ?? '尚未填写'}`;
  if (matcher.kind === 'rule') return `本地规则 · ${ruleToLine(matcher.rule)}`;
  if (matcher.repository) return matcher.repository.sources.map(source => source.name ?? `${matcher.repository!.name} · ${source.repository?.path}`).join('、');
  if (matcher.remote) return matcher.remote.url || '远程规则';
  return ctx.rulesets.find(r => r.id === matcher.id)?.name ?? matcher.id ?? '增强集合';
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report, onRuleValidationReady, readOnly = false, saveHint = '保存模板后生效', title = '规则', hideFinal = false, staticOnly = false, renderTarget, renderOptions, importedUrls }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
  onRuleValidationReady: (id: string, ready: boolean) => void;
  readOnly?: boolean; saveHint?: string; title?: string; hideFinal?: boolean; staticOnly?: boolean; importedUrls?: string[];
  renderTarget?: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => ReactNode;
  renderOptions?: (rule: RuleEntry, onChange: (rule: RuleEntry) => void) => ReactNode;
}) {
  const [linkError, setLinkError] = useState<string>();
  const [linkingRule, setLinkingRule] = useState<string>();
  const [newRule, setNewRule] = useState<RuleEntry>();
  const currentValue = useRef(value);
  currentValue.current = value;
  const remoteUrls = readOnly ? [] : value.rules.flatMap(r => r.matcher.kind === 'ruleset' && r.matcher.remote ? [r.matcher.remote.url] : []);
  const repositoryMatches = useRepositoryUrlMatches();
  useEffect(() => { if (importedUrls && !readOnly) void repositoryMatches.detect(importedUrls); }, [importedUrls, readOnly, repositoryMatches.detect]);
  const [preview, setPreview] = useState<Matcher>();
  const rule = newRule?.id === selected ? newRule : value.rules.find(r => r.id === selected);
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map(r => r.id === rule.id ? rule : r) });
  const close = () => { setNewRule(undefined); onSelect(undefined); };
  const add = (matcher: Matcher) => {
    const next = { id: newId('r'), matcher, target: value.final };
    setNewRule(next); onSelect(next.id);
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
      repositoryMatches.clear([url]);
    } catch (error) { setLinkError(error instanceof Error ? error.message : String(error)); }
    finally { setLinkingRule(undefined); }
  };
  return <>
    <Card title={title} subtitle={`${value.rules.length} 项 · 自上而下匹配`} actions={!readOnly && <>
      {!staticOnly && <Button size="sm" disabled={!remoteUrls.length || repositoryMatches.isPending} onClick={() => void repositoryMatches.detect(remoteUrls)}><ScanSearch size={15} />{repositoryMatches.isPending ? '检测中…' : '检测仓库关联'}</Button>}
      <Button size="sm" aria-label="添加本地规则" onClick={() => add({ kind: 'local', content: '' })}><Plus size={15} />本地规则</Button>
      {!staticOnly && <><Button size="sm" onClick={() => add({ kind: 'ruleset', id: '', remote: { url: '' } })}>远程链接</Button><Button size="sm" onClick={() => add({ kind: 'ruleset', id: '' })}>引用规则</Button></>}
    </>}>
      <ErrorAlert error={repositoryMatches.error} />{linkError && <FieldError error={linkError} />}
      {!value.rules.length && <Empty title="没有规则" description={hideFinal ? '先于模板规则匹配，仅影响本订阅。' : '未匹配的流量走 MATCH。'} />}
      <SortableList items={value.rules} getKey={r => r.id} isLocked={() => readOnly} onReorder={rules => onChange({ ...value, rules })} renderItem={(r, i, handle) => {
        const matcher = r.matcher;
        const local = matcher.kind !== 'ruleset';
        const label = ruleMatcherLabel(matcher, ctx);
        return <RuleCard id={`template-rule-${r.id}`} label={`第 ${i + 1} 项规则`} handle={handle} readOnly={readOnly}
          invalid={report.some(item => item.level === 'error' && item.where === `rule:${r.id}`)}
          icon={local ? <FileText size={18} /> : matcher.remote ? <Globe size={18} /> : <Link2 size={18} />}
          count={local ? <Badge>{matcher.kind === 'local' ? localRuleLines(matcher.content).length : 1} 条</Badge> : undefined}
          hint={!readOnly && matcher.kind === 'ruleset' && matcher.remote && <RepositoryMatchHint label={`第 ${i + 1} 项规则可关联仓库文件`} matches={repositoryMatches.matches[matcher.remote.url] ?? []} busy={!!linkingRule} onLink={match => linkRepository(r.id, matcher.remote!.url, match)} />}
          target={readOnly ? <span className="block truncate text-center text-[13px]" title={targetLabel(r.target, groupName, ref => ref.id)}>{targetLabel(r.target, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(r.target, target => update({ ...r, target }), `第 ${i + 1} 项规则出口`) : <TemplateTargetSelect label={`第 ${i + 1} 项规则出口`} value={r.target} groups={value.groups} onChange={target => update({ ...r, target })} />}
          onPreview={() => setPreview(matcher)} onEdit={() => onSelect(r.id)} onDelete={() => {
            onChange({ ...value, rules: value.rules.filter(item => item.id !== r.id) });
            if (matcher.kind === 'ruleset' && matcher.remote) repositoryMatches.clear([matcher.remote.url]);
            if (selected === r.id) close();
          }}><span title={label}>{label}</span></RuleCard>;
      }} />
      {!hideFinal && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-3 text-[13px]">
        <span className="font-mono">MATCH</span>
        <div id="template-rule-final" className="w-[136px] min-w-0">
          {readOnly ? <span>{targetLabel(value.final, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(value.final, final => onChange({ ...value, final }), 'MATCH 出口') : <TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={final => onChange({ ...value, final })} />}
        </div><ItemIssues report={report} where="final" />
      </div>}
    </Card>
    {!readOnly && rule && <RuleEditDialog key={rule.id} rule={rule} index={value.rules.indexOf(rule)} ctx={ctx} staticOnly={staticOnly} adding={newRule?.id === rule.id} saveHint={saveHint} renderOptions={renderOptions} onClose={close} onSave={draft => {
      const added = newRule?.id === draft.id;
      const old = value.rules.find(r => r.id === draft.id)?.matcher;
      const url = draft.matcher.kind === 'ruleset' ? draft.matcher.remote?.url : undefined;
      if (old?.kind === 'ruleset' && old.remote && old.remote.url !== url) repositoryMatches.clear([old.remote.url]);
      onChange(applyRuleDraft(currentValue.current, draft, added));
      if (added && url) void repositoryMatches.detect([url]);
      onRuleValidationReady(draft.id, true); close();
    }} />}
    <RuleSourcePreview matcher={preview} onClose={() => setPreview(undefined)} />
  </>;
}
