import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { rulePreviewLinks } from '../../domain/rulePreview.ts';
import { type Matcher, type ReportItem, type RuleEntry, localRuleLines } from '@sub-forge/core';
import { ChevronDown, Link2, Plus, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TemplateBoundList } from '../../components/TemplateBoundList.tsx';
import { targetLabel } from '../../components/pickers.tsx';
import { ruleToLine } from '../../components/rule.ts';
import { Badge, Button, Card, Empty, ErrorAlert, FieldError } from '../../components/ui.tsx';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches, type RepositoryUrlMatch } from '../../hooks/useRepositoryUrlMatches.ts';
import { RuleSourcePreview } from '../../components/RuleSourcePreview.tsx';
import { RuleCard, RuleFinalCard, type RuleKind } from '../../components/RuleCard.tsx';
import { RepositoryMatchHint } from '../../components/RepositoryMatchHint.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { RuleEditDialog } from './RuleEditDialog.tsx';
import { applyRuleDraft, applyRuleDialogResult, linkRepositoryRules } from './ruleDraft.ts';

const ruleMatcherKind = (matcher: Matcher): RuleKind => matcher.kind !== 'ruleset' ? 'local' : matcher.remote ? 'remote' : matcher.repository ? 'repository' : 'collection';

export function ruleMatcherLabel(matcher: Matcher, ctx: ConvertCtx) {
  if (matcher.kind === 'local') return localRuleLines(matcher.content).map(line => line.text).join(',') || '尚未填写';
  if (matcher.kind === 'rule') return ruleToLine(matcher.rule);
  if (matcher.repository) return matcher.repository.sources.map(source => source.name ?? `${matcher.repository!.name} · ${source.repository?.path}`).join('、');
  if (matcher.remote) return matcher.remote.url || '远程规则';
  return ctx.rulesets.find(r => r.id === matcher.id)?.name ?? matcher.id ?? '增强集合';
}

export function TemplateRulesEditor({ value, onChange, ctx, report, onRuleValidationReady, readOnly = false, title = '规则', hideFinal = false, staticOnly = false, renderTarget, extendedOptions, importedUrls, templateRuleIds, templateStart }: {
  value: TemplateBody; onChange: (value: TemplateBody, templateStart?: number) => void; ctx: ConvertCtx; report: ReportItem[];
  onRuleValidationReady: (id: string, ready: boolean) => void;
  readOnly?: boolean; title?: string; hideFinal?: boolean; staticOnly?: boolean; importedUrls?: string[];
  renderTarget?: (value: TemplateBody['final'], onChange: (target: TemplateBody['final']) => void, label: string) => ReactNode;
  templateRuleIds?: string[]; templateStart?: number;
  extendedOptions?: boolean;
}) {
  const ruleReadOnly = (rule: RuleEntry) => readOnly || !!templateRuleIds?.includes(rule.id);
  const [search, setSearch] = useState('');
  const [linkError, setLinkError] = useState<string>();
  const [linkingRule, setLinkingRule] = useState<string>();
  const currentValue = useRef(value);
  currentValue.current = value;
  const remoteUrls = readOnly ? [] : value.rules.filter(r => !ruleReadOnly(r)).flatMap(r => r.matcher.kind === 'ruleset' && r.matcher.remote ? [r.matcher.remote.url] : []);
  const repositoryMatches = useRepositoryUrlMatches();
  useEffect(() => { if (importedUrls && !readOnly) void repositoryMatches.detect(importedUrls); }, [importedUrls, readOnly, repositoryMatches.detect]);
  const linkableCount = remoteUrls.filter(url => repositoryMatches.matches[url]?.length === 1).length;
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map(r => r.id === rule.id ? rule : r) });
  const edit = async (rule: RuleEntry, adding = false) => {
    const result = await RuleEditDialog.show({ rule, index: value.rules.indexOf(rule), ctx, staticOnly, adding, extendedOptions, bound: !!templateRuleIds, groups: value.groups });
    if (result.status !== 'confirmed') return;
    const draft = result.data.rule;
    const old = currentValue.current.rules.find(r => r.id === draft.id)?.matcher;
    const url = draft.matcher.kind === 'ruleset' ? draft.matcher.remote?.url : undefined;
    if (old?.kind === 'ruleset' && old.remote && old.remote.url !== url) repositoryMatches.clear([old.remote.url]);
    const next = applyRuleDialogResult(currentValue.current, draft, adding, result.data.position, templateRuleIds, templateStart);
    onChange(next.body, next.templateStart);
    if (adding && url) void repositoryMatches.detect([url]);
    onRuleValidationReady(draft.id, true);
  };
  const add = (matcher: Matcher) => void edit({ id: newId('r'), matcher, target: value.final }, true);
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
  const linkAllRepositories = () => repositoryMatches.linkAll(remoteUrls, resolved => {
    const next = linkRepositoryRules(currentValue.current, resolved, rule => !ruleReadOnly(rule));
    if (next.linked) onChange(next.body);
    return next.linked;
  });
  return <>
    <Card title={title} count={value.rules.length} actions={<><SearchInput className="w-[220px] shrink-0" aria-label="搜索规则" placeholder="搜索规则内容或出口" value={search} onChange={event => setSearch(event.target.value)} />{!readOnly && <>
      {!staticOnly && remoteUrls.length > 0 && <Button variant="ghost" disabled={repositoryMatches.isPending || repositoryMatches.isLinkingAll} onClick={() => void repositoryMatches.detect(remoteUrls)}><ScanSearch size={15} />{repositoryMatches.isPending ? '检测中…' : '检测仓库关联'}</Button>}
      {!staticOnly && linkableCount > 0 && <Button disabled={repositoryMatches.isLinkingAll || !!linkingRule} onClick={() => void linkAllRepositories()}><Link2 size={15} />{repositoryMatches.isLinkingAll ? '关联中…' : `一键关联 ${linkableCount} 项`}</Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus size={16} />添加规则<ChevronDown size={14} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72">
        {!staticOnly && <><DropdownMenuItem onSelect={() => add({ kind: 'ruleset', id: '' })}><span><span className="block">系统规则集</span><span className="text-xs text-muted-foreground">搜索规则仓库文件或规则集合</span></span></DropdownMenuItem><DropdownMenuItem onSelect={() => add({ kind: 'ruleset', id: '', remote: { url: '' } })}><span><span className="block">远程地址</span><span className="text-xs text-muted-foreground">填写 HTTP(S) 规则文件 URL</span></span></DropdownMenuItem></>}
        <DropdownMenuItem onSelect={() => add({ kind: 'local', content: '' })}><span><span className="block">本地规则</span><span className="text-xs text-muted-foreground">每行一条，如 DOMAIN-SUFFIX,openai.com</span></span></DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>

    </>}</>}>
      <ErrorAlert error={repositoryMatches.error} />{linkError && <FieldError error={linkError} />}
      {!value.rules.length && <Empty variant="card" title="没有规则" description={hideFinal ? '先于模板规则匹配，仅影响本订阅。' : '未匹配的流量走 MATCH。'} />}
      <TemplateBoundList label="规则" items={value.rules} templateIds={templateRuleIds} templateStart={templateStart} isLocked={rule => ruleReadOnly(rule) || !!search.trim()} onReorder={(rules, start) => onChange({ ...value, rules }, start)} renderItem={(r, i, handle) => {
        if (search.trim() && !`${ruleMatcherLabel(r.matcher, ctx)} ${targetLabel(r.target, groupName, ref => ref.id)}`.toLowerCase().includes(search.trim().toLowerCase())) return null;
        const readOnly = ruleReadOnly(r);
        const matcher = r.matcher;
        const local = matcher.kind !== 'ruleset';
        const label = ruleMatcherLabel(matcher, ctx);
        return <RuleCard id={`template-rule-${r.id}`} label={`第 ${i + 1} 项规则`} handle={handle} readOnly={readOnly}
          invalid={report.some(item => item.level === 'error' && item.where === `rule:${r.id}`)}
          kind={ruleMatcherKind(matcher)}
          count={local ? <Badge>{matcher.kind === 'local' ? localRuleLines(matcher.content).length : 1} 条</Badge> : undefined}
          hint={!readOnly && matcher.kind === 'ruleset' && matcher.remote && <RepositoryMatchHint label={`第 ${i + 1} 项规则可关联仓库文件`} matches={repositoryMatches.matches[matcher.remote.url] ?? []} busy={!!linkingRule || repositoryMatches.isLinkingAll} onLink={match => linkRepository(r.id, matcher.remote!.url, match)} />}
          target={readOnly ? <span className="block truncate pr-1.5 pl-3 text-sm" title={targetLabel(r.target, groupName, ref => ref.id)}>{targetLabel(r.target, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(r.target, target => update({ ...r, target }), `第 ${i + 1} 项规则出口`) : <TemplateTargetSelect label={`第 ${i + 1} 项规则出口`} value={r.target} groups={value.groups} onChange={target => update({ ...r, target })} />}
          externalPreview={!local} previewLinks={rulePreviewLinks(matcher)} onPreview={() => void RuleSourcePreview.show({ matcher })} onEdit={() => void edit(r)} onDelete={() => {
            onChange({ ...value, rules: value.rules.filter(item => item.id !== r.id) });
            if (matcher.kind === 'ruleset' && matcher.remote) repositoryMatches.clear([matcher.remote.url]);
          }}><span title={label}>{label}</span></RuleCard>;
      }} />
      {!hideFinal && <>
        <RuleFinalCard readOnly={readOnly || !!templateRuleIds} targetId="template-rule-final" target={readOnly || templateRuleIds ? <span className="block truncate pr-1.5 pl-3" title={targetLabel(value.final, groupName, ref => ref.id)}>{targetLabel(value.final, groupName, ref => ref.id)}</span> : renderTarget ? renderTarget(value.final, final => onChange({ ...value, final }), 'MATCH 出口') : <TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={final => onChange({ ...value, final })} />} />
        <ItemIssues report={report} where="final" />
      </>}
    </Card>
  </>;
}
