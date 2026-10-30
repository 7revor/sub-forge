import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog.tsx';
import { useDialogDraft } from '../hooks/useDialogDraft.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stableStringify, type ReportItem } from '@sub-forge/core';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, type ImpactEntry } from '../api.ts';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { LeaveDialog } from '../components/LeaveDialog.tsx';
import { Notice } from '../components/Notice.tsx';
import { Pagination } from '../components/Pagination.tsx';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorAlert, Field, FieldError, Input, PageHeader, PageScroll, td, th, cx } from '../components/ui.tsx';
import { useList, useRuleSetRefs, type TemplateDoc } from '../hooks.ts';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { usePagedList } from '../hooks/usePagedList.ts';
import { newId, templateFromYaml, type ConvertCtx, type TemplateBody } from '../convert/templateYaml.ts';
import { boundTemplateId } from './profile/routing.ts';
import { TemplateGroupsEditor } from './template/TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from './template/TemplateRulesEditor.tsx';
import { TemplateReport } from './template/TemplateFields.tsx';
import { draftIssues } from './template/model.ts';

export function TemplateList() {
  const list = usePagedList('templates');
  const [params] = useSearchParams();
  const profiles = useList('profiles');
  const selectedId = params.get('id');
  const inUse = (id: string) => (profiles.data ?? []).filter((p) => boundTemplateId(p) === id).length;
  // 兼容发布完成和旧书签中的模板定位链接。
  if (selectedId) return <Navigate to={`/templates/${encodeURIComponent(selectedId)}`} replace />;
  return (
    <>
      <PageHeader title="模板"
        actions={<Link to="/templates/new" className={buttonClass('primary')}><Plus size={16} />新建模板</Link>} />
      <ErrorAlert error={list.error} />
      <section className="list-panel" aria-label="模板列表" aria-busy={list.isFetching}>
        <div className="shrink-0 px-4 py-3.5"><Input aria-label="搜索模板" placeholder="搜索名称" className="max-w-[280px]" value={list.q} onChange={e => list.setQ(e.target.value)} /></div>
        <div key={`${list.data?.page}-${list.pageSize}-${list.q}`} className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {!list.data ? <div className="p-4 text-ink-muted">{list.error ? '列表加载失败，请重试。' : '加载中…'}{list.error && <Button size="sm" onClick={() => void list.refetch()}>重试</Button>}</div> : !list.data.items.length ? (
            <div className="p-4"><Empty title={list.q.trim() ? `没有名称包含「${list.q.trim()}」的模板` : '还没有模板'} action={!list.q.trim() && <Link to="/templates/new" className={buttonClass('default', 'sm')}>新建模板</Link>} /></div>
          ) : <table className="w-full border-collapse">
            <thead><tr>{['名称', '策略组', '规则', '使用情况'].map(label => <th key={label} className={th}>{label}</th>)}<th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
            <tbody>{list.data.items.map(t => {
              const n = inUse(t.id);
              const path = `/templates/${encodeURIComponent(t.id)}`;
              return <DocTableRow key={t.id} to={path}>
                <td className={td}><Link to={path} className={docNameLinkClass}>{t.name ?? t.id}</Link></td>
                <td className={td}>{t.groups.length} 个</td>
                <td className={td}>{t.rules.length} 条</td>
                <td className={cx(td, 'whitespace-nowrap text-ink-2')}>{n ? `${n} 个配置订阅在用` : '未使用'}</td>
                <td className={cx(td, 'whitespace-nowrap text-right')}><div className="flex justify-end gap-2">
                  <DocActionLink to={path} name={t.name ?? t.id} viewOnly />
                  <Link to={`/profiles/new?template=${encodeURIComponent(t.id)}`} className={buttonClass('default', 'sm')}>新建订阅</Link>
                </div></td>
              </DocTableRow>;
            })}</tbody>
          </table>}
        </div>
        <Pagination page={list.data?.page ?? list.page} pageSize={list.pageSize} total={list.data?.total ?? 0} totalPages={list.data?.totalPages ?? 1}
          busy={list.isFetching || !list.data} onPage={list.setPage} onPageSize={list.setPageSize} />
      </section>
    </>
  );
}


type TemplateDraft = { name: string; body: TemplateBody };
type TemplateResponse = { item: TemplateDoc; report?: ReportItem[]; impact?: ImpactEntry[] };

function draftFromTemplate(t: TemplateDoc): TemplateDraft {
  return { name: t.name ?? '', body: { groups: t.groups, rules: t.rules, final: t.final, ...(t.ruleProviders ? { ruleProviders: t.ruleProviders } : {}) } };
}

function emptyTemplate(): TemplateDraft {
  const id = newId('g');
  return { name: '', body: { groups: [{ id, name: '节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'group', groupId: id } } };
}

/** 旧详情、编辑和发布书签统一落到同一个页面。 */
export function TemplateEdit() {
  const { id = 'new', tab } = useParams();
  const tpl = useQuery({ queryKey: ['template', id], enabled: id !== 'new' && !tab, queryFn: () => api<TemplateResponse>('GET', `/templates/${encodeURIComponent(id)}`) });
  if (tab) return <Navigate to={`/templates/${encodeURIComponent(id)}`} replace />;
  if (id !== 'new' && !tpl.data) return tpl.error ? <ErrorAlert error={tpl.error} /> : <div className="text-ink-muted">加载中…</div>;
  return <TemplatePage key={id} id={id} initial={tpl.data?.item} />;
}

/** 详情即编辑：只维护一份页面草稿，保存时由服务端完成自检和绑定影响检查。 */
function TemplatePage({ id, initial }: { id: string; initial?: TemplateDoc }) {
  const isNew = id === 'new';
  const qc = useQueryClient();
  const profiles = useList('profiles');
  const rulesets = useRuleSetRefs();
  const ctx: ConvertCtx = { rulesets: rulesets.data ?? [] };
  const [base, setBase] = useState(() => initial ? draftFromTemplate(initial) : emptyTemplate());
  const [draft, setDraft] = useState(base);
  const [group, setGroup] = useState<string>();
  const [rule, setRule] = useState<string>();
  const [pendingRules, setPendingRules] = useState<Set<string>>(() => new Set());
  const onRuleValidationReady = (id: string, ready: boolean) => setPendingRules(current => {
    const next = new Set(current);
    if (ready) next.delete(id);
    else next.add(id);
    return next;
  });
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yaml, setYaml] = useDialogDraft(yamlOpen, '');
  const [yamlBase] = useDialogDraft(yamlOpen, draft.body);
  const [discardYaml, setDiscardYaml] = useState(false);
  const [validation, setValidation] = useState<{ draft: TemplateDraft; report: ReportItem[]; error?: string }>();
  const [savedWarnings, setSavedWarnings] = useState<ReportItem[]>([]);
  const body = draft.body;
  const dirty = stableStringify(draft) !== stableStringify(base);
  const yamlDirty = yamlOpen && yaml !== '';
  const { blocker, leave } = useLeaveGuard(dirty || yamlDirty);
  const showingLeave = blocker.state === 'blocked';
  const currentValidation = validation?.draft === draft ? validation : undefined;
  const report = [...draftIssues(body), ...(currentValidation?.report ?? [])];
  const errors = report.filter(r => r.level === 'error');
  // 首次失焦前隐藏新增规则的问题；保存仍使用完整报告，不能绕过校验。
  const visibleReport = report.filter(r => !r.where?.startsWith('rule:') || !pendingRules.has(r.where.slice(5)));
  const visibleErrors = visibleReport.filter(r => r.level === 'error');
  const firstLocation = visibleErrors.find(r => r.where && /^(group:|rule:|final$)/.test(r.where))?.where;
  const inUse = (profiles.data ?? []).filter(p => boundTemplateId(p) === id).length;
  const updateBody = (body: TemplateBody) => setDraft(current => ({ ...current, body }));
  const locate = (where: string) => {
    if (where.startsWith('group:')) { setGroup(where.slice(6)); setRule(undefined); }
    if (where.startsWith('rule:')) { setRule(where.slice(5)); setGroup(undefined); }
    if (where === 'final') setRule('final');
  };

  // 只同步最初读取及保存结果；后台重新获取数据不会覆盖尚未保存的页面草稿。
  useEffect(() => {
    if (!draft.name.trim() || draftIssues(draft.body).length) return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ report: ReportItem[] }>('POST', '/templates/validate', { ...draft.body, name: draft.name, ...(isNew ? {} : { id }) }).then(
        result => { if (active) setValidation({ draft, report: result.report }); },
        (error: Error) => { if (active) setValidation({ draft, report: [], error: error.message }); },
      );
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [draft, id, isNew]);

  const save = useMutation({
    meta: { successMessage: '模板已保存' },
    mutationFn: (value: TemplateDraft) => api<TemplateResponse>(isNew ? 'POST' : 'PUT', isNew ? '/templates' : `/templates/${encodeURIComponent(id)}`, { ...value.body, name: value.name.trim() }),
    onSuccess: result => {
      const next = draftFromTemplate(result.item);
      setBase(next); setDraft(next); setPendingRules(new Set());
      setSavedWarnings([...(result.report ?? []).filter(r => r.level === 'warn'), ...(result.impact ?? []).flatMap(i => i.issues.filter(r => r.level === 'warn'))]);
      qc.setQueryData(['template', result.item.id], { item: result.item });
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['profiles'] });
      if (isNew && blocker.state !== 'blocked') leave(`/templates/${encodeURIComponent(result.item.id)}`, { replace: true });
    },
  });
  useEffect(() => { save.reset(); if (dirty) setSavedWarnings([]); }, [draft]); // 草稿变化后清除上一次保存结果。
  const failure = save.error instanceof ApiError && save.error.details && typeof save.error.details === 'object' ? save.error.details as { report?: ReportItem[]; impact?: ImpactEntry[] } : undefined;
  const canSave = !!draft.name.trim() && !errors.length && !currentValidation?.error && !yamlOpen && !save.isPending;
  const yamlResult = useMemo(() => templateFromYaml(yaml, yamlBase, ctx), [yaml, yamlBase, rulesets.data]);
  const openYaml = () => { setYamlOpen(true); setDiscardYaml(false); };
  const closeYaml = () => { if (yamlDirty) setDiscardYaml(true); else setYamlOpen(false); };

  return <>
    <PageHeader title={isNew ? '新建模板' : '模板详情'} crumbs={<Link to="/templates" className="text-ink-muted no-underline">模板</Link>}
      actions={<><Link to="/templates" className={buttonClass()}>返回列表</Link><Button variant="primary" disabled={!canSave || (!isNew && !dirty)} onClick={() => save.mutate(draft)}>{save.isPending ? '检查并保存中…' : '保存模板'}</Button></>}>
      {dirty && <Badge tone="warn">未保存</Badge>}
    </PageHeader>
    <PageScroll>
      <ErrorAlert error={save.error ?? rulesets.error} />
      {currentValidation?.error && <FieldError error={currentValidation.error} />}
      {visibleErrors.length > 0 && <Notice tone="err" actions={firstLocation && <Button size="sm" onClick={() => locate(firstLocation)}>定位</Button>}>
        <span>{visibleErrors[0]!.message}{visibleErrors.length > 1 ? `（共 ${visibleErrors.length} 项待修复）` : ''}</span>
      </Notice>}
      {failure?.report?.length ? <Card title="保存检查"><TemplateReport items={failure.report} onLocate={locate} /></Card> : null}
      {!!failure?.impact?.length && <Card title="请先修复绑定订阅冲突">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">{failure.impact.map(item => <li key={item.profileId} className="text-[13px]">
          <Link to={`/profiles/${item.profileId}/groups`} className="font-medium text-brand">{item.profileName}</Link>
          <ul className="mt-1 pl-5 text-ink-2">{item.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
        </li>)}</ul>
      </Card>}
      {savedWarnings.length > 0 && <Card title="已保存 · 注意事项"><TemplateReport items={savedWarnings} onLocate={locate} /></Card>}
      <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-panel px-4.5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2"><Pencil size={14} className="shrink-0 text-ink-muted" aria-hidden /><input aria-label="模板名称" placeholder="填写模板名称" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="h-9 w-full max-w-[400px] rounded border border-transparent bg-panel px-1 text-[17px] font-semibold hover:border-line focus:border-brand" /></div>
            <span className="text-[12.5px] text-ink-muted">{body.groups.length} 个策略组 · {body.rules.length} 条规则{!isNew && ` · ${inUse} 个绑定订阅`}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openYaml}>从 YAML 导入</Button>
            {!isNew && <Link to={`/profiles/new?template=${encodeURIComponent(id)}`} className={buttonClass()}>新建配置订阅</Link>}
          </div>
        </section>
        <TemplateGroupsEditor value={body} onChange={updateBody} selected={showingLeave ? undefined : group} onSelect={setGroup} report={report} />
        <TemplateRulesEditor value={body} onChange={updateBody} selected={showingLeave ? undefined : rule} onSelect={setRule} ctx={ctx} report={visibleReport} onRuleValidationReady={onRuleValidationReady} />
      </fieldset>
    </PageScroll>
    <Dialog open={yamlOpen && !showingLeave} onOpenChange={next => { if (!next) (closeYaml)(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{"从 YAML 导入"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      <Field label="mihomo YAML" hint="导入后通过策略组和规则表单维护，应用后仍需保存模板。">{fid => <YamlTextarea id={fid} rows={18} spellCheck={false} value={yaml ?? ''} onChange={e => { setYaml(e.target.value); setDiscardYaml(false); }} />}</Field>
      {!!yaml?.trim() && yamlResult && !yamlResult.ok && <FieldError error={`第 ${yamlResult.line ?? 1} 行：${yamlResult.error}`} />}
      {yamlResult?.ok && yamlResult.notes.length > 0 && <ul className="m-0 pl-5 text-[12.5px] text-ink-muted">{yamlResult.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
    </div><DialogFooter>{discardYaml ? <>
      <span className="mr-auto self-center text-[12px] text-ink-muted">放弃这次 YAML 导入？</span><Button onClick={() => setDiscardYaml(false)}>继续导入</Button><Button variant="danger" onClick={() => setYamlOpen(false)}>放弃导入</Button>
    </> : <><Button onClick={closeYaml}>取消</Button><Button variant="primary" disabled={!yamlResult?.ok} onClick={() => { if (yamlResult?.ok) { updateBody(structuredClone(yamlResult.value)); setYamlOpen(false); } }}>保存</Button></>}</DialogFooter></DialogContent></Dialog>
    <LeaveDialog blocker={blocker} what="模板" canSave={canSave} pending={save.isPending} error={save.error}
      onSave={done => save.mutate(draft, { onSuccess: done })} onDiscard={() => { setDraft(base); setYamlOpen(false); setGroup(undefined); setRule(undefined); setPendingRules(new Set()); }} />
  </>;
}
