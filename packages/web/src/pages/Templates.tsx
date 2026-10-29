import { boundTemplateId } from './profile/routing.ts';
import { usePagedList } from '../hooks/usePagedList.ts';
import { Pagination } from '../components/Pagination.tsx';
import { alertError, notifySuccess } from '../feedback.ts';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { Notice } from '../components/Notice.tsx';
import { VersionHistory } from './template/VersionHistory.tsx';
// 模板：点击列表进入详情（组骨架、完整规则、版本记录）；通过编辑入口修改并发布新版本。
// 表单与 mihomo YAML 共用草稿，修改后即时校验（TPL-11）；发布前分析影响（TPL-07）。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportItem } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, type ImpactEntry, type User } from '../api.ts';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { memberLabel, targetLabel } from '../components/pickers.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorAlert, FieldError, Field, Input, Modal, PageHeader, PageScroll, Textarea, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useMe, useRuleSetRefs, type TemplateDoc } from '../hooks.ts';
import { newId, templateFromYaml, templateToYaml, type ConvertCtx, type TemplateBody } from '../convert/templateYaml.ts';
import { templateDiff } from '../convert/templateDiff.ts';
import { TemplateEditor } from './template/TemplateEditor.tsx';
import { TemplateDiff } from './template/TemplateDiff.tsx';
import { matcherLabel, TemplateReport } from './template/TemplateFields.tsx';
import { draftIssues } from './template/model.ts';

type TemplateDetailData = { item: TemplateDoc; versions: { version: number; changelog?: string; createdAt: number }[] };

/** 模板列表与其他文档列表保持一致；骨架、规则与版本记录在独立详情页查看。 */
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
          {!list.data ? <div className="p-4 text-muted">{list.error ? '列表加载失败，请重试。' : '加载中…'}{list.error && <Button size="sm" onClick={() => void list.refetch()}>重试</Button>}</div> : !list.data.items.length ? (
            <div className="p-4"><Empty title={list.q.trim() ? `没有名称包含「${list.q.trim()}」的模板` : '还没有模板'} action={!list.q.trim() && <Link to="/templates/new" className={buttonClass('default', 'sm')}>新建模板</Link>} /></div>
          ) : <table className="w-full border-collapse">
            <thead><tr>{['名称', '版本', '策略组', '规则', '使用情况'].map(label => <th key={label} className={th}>{label}</th>)}<th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
            <tbody>{list.data.items.map(t => {
              const n = inUse(t.id);
              const path = `/templates/${encodeURIComponent(t.id)}`;
              return <DocTableRow key={t.id} to={path}>
                <td className={td}><Link to={path} className={docNameLinkClass}>{t.name ?? t.id}</Link></td>
                <td className={cx(td, 'font-mono')}>v{t.version}</td>
                <td className={td}>{t.groups.length} 个</td>
                <td className={td}>{t.rules.length} 条</td>
                <td className={cx(td, 'whitespace-nowrap text-ink-2')}>{n ? `${n} 个配置订阅在用` : '未使用'}</td>
                <td className={cx(td, 'whitespace-nowrap text-right')}><div className="flex justify-end gap-2">
                  <DocActionLink to={path} name={t.name ?? t.id} viewOnly />
                  <DocActionLink to={`${path}/edit`} name={t.name ?? t.id} />
                  <Link to={`${path}/publish`} className={buttonClass('default', 'sm')}>发布</Link>
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

function TemplateOverview({ id }: { id: string }) {
  const profiles = useList('profiles');
  return <>
    <PageHeader title="模板详情" crumbs={<Link to="/templates" className="text-muted no-underline">模板</Link>}
      actions={<Link to="/templates" className={buttonClass()}>返回列表</Link>} />
    <PageScroll><TemplateDetail id={id} inUse={(profiles.data ?? []).filter(p => boundTemplateId(p) === id).length} actions={<>
      <Link to={`/templates/${id}/edit`} className={buttonClass()}>编辑新版本</Link>
      <Link to={`/templates/${id}/publish`} className={buttonClass()}>发布</Link>
      <Link to={`/profiles/new?template=${encodeURIComponent(id)}`} className={buttonClass('primary')}>用这个模板新建配置订阅</Link>
    </>} /></PageScroll>
  </>;
}

/** 模板详情默认展示全部规则；版本记录与对比通过顶部按钮打开弹窗。 */
function TemplateDetail({ id, inUse, actions }: { id: string; inUse?: number; actions?: ReactNode }) {
  const tpl = useQuery({ queryKey: ['template', id], queryFn: () => api<TemplateDetailData>('GET', `/templates/${id}`) });
  const rulesets = useRuleSetRefs();
  const ctx: ConvertCtx = { rulesets: (rulesets.data ?? []).map(({ id, name }) => ({ id, name })) };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffVersion, setDiffVersion] = useState<number>();
  if (!tpl.data) return tpl.error ? <ErrorAlert error={tpl.error} /> : <div className="text-muted">加载中…</div>;
  const { item: t, versions } = tpl.data;
  const groupName = (gid: string) => t.groups.find((g) => g.id === gid)?.name ?? gid;
  const nsName = () => '';
  const published = versions.find((v) => v.version === t.version)?.createdAt;
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-panel px-4.5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[17px] font-semibold">{t.name ?? t.id} <span className="font-mono text-[13px] font-medium text-muted">v{t.version}</span></h2>
          <span className="text-[12.5px] text-muted">{t.groups.length} 个策略组 · {t.rules.length} 条规则{published ? ` · 发布于 ${formatTime(published).slice(5, 10)}` : ''}{inUse !== undefined ? ` · 你有 ${inUse} 个配置订阅在用` : ''}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setHistoryOpen(true)}>版本记录</Button>
          {actions}
        </div>
      </section>
      <Card title="策略组骨架" bodyClass="overflow-x-auto">
        {!t.groups.length ? <div className="px-4 pb-4"><Empty title="还没有组" /></div> : <table className="w-full border-collapse">
          <thead><tr><th className={th}>组</th><th className={th}>类型</th><th className={th}>成员（组 / 内置）</th></tr></thead>
          <tbody>
            {t.groups.map((g) => (
              <tr key={g.id}>
                <td className={cx(td, 'font-medium whitespace-nowrap')}>{g.name}</td>
                <td className={cx(td, 'font-mono text-[12.5px]')}>{g.type.toUpperCase()}</td>
                <td className={cx(td, 'text-[12.5px] text-ink-2')}>{g.members.map((m) => memberLabel(m, groupName, nsName).text).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </Card>
      <Card title="规则" className="min-w-0" actions={<span className="text-[12.5px] text-muted">{t.rules.length} 条</span>} bodyClass="pb-1">
        {!t.rules.length && <div className="px-4 pb-4"><Empty title="没有规则" description="未匹配的流量走 MATCH。" /></div>}
        {t.rules.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[28px_minmax(0,1.4fr)_16px_minmax(0,0.8fr)] items-center gap-2 border-t border-line-2 px-4 py-2.5 text-[13px]">
            <span className="font-mono text-[12px] text-muted">{i + 1}</span>
            {r.matcher.kind === 'ruleset' && r.matcher.remote ? (
              <span className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
                <span className="shrink-0">远程 ·</span>
                <span dir="rtl" title={r.matcher.remote.url} className="truncate text-left"><bdi dir="ltr">{r.matcher.remote.url}</bdi></span>
              </span>
            ) : <span className="truncate font-mono text-[12.5px]" title={matcherLabel(r.matcher, ctx)}>{matcherLabel(r.matcher, ctx)}</span>}
            <span aria-hidden="true" className="text-faint">→</span>
            <span className="truncate">{targetLabel(r.target, groupName, nsName)}</span>
          </div>
        ))}
        <div className="grid grid-cols-[28px_minmax(0,1.4fr)_16px_minmax(0,0.8fr)] items-center gap-2 border-t border-line-2 px-4 py-2.5 text-[13px]">
          <span className="font-mono text-[12px] text-muted">—</span><span className="font-mono text-[12.5px]">MATCH</span><span aria-hidden="true" className="text-faint">→</span><span>{targetLabel(t.final, groupName, nsName)}</span>
        </div>
      </Card>
      <Modal title="版本记录" open={historyOpen && diffVersion === undefined} onClose={() => setHistoryOpen(false)}>
        <VersionHistory versions={versions} onCompare={setDiffVersion} />
      </Modal>
      {diffVersion !== undefined && <TemplateDiff id={id} version={diffVersion} ctx={ctx} onClose={() => setDiffVersion(undefined)} />}
    </>
  );
}

function skeleton(): TemplateBody {
  const id = newId('g');
  return {
    groups: [{ id, name: '节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }],
    rules: [], final: { kind: 'group', groupId: id },
  };
}

export function TemplateEdit() {
  const { id = 'new', tab } = useParams();
  if (id !== 'new' && tab !== 'edit' && tab !== 'publish') return <TemplateOverview key={id} id={id} />;
  return <TemplatePage key={id} id={id} />;
}

/** 管理员编辑模板（设计稿「管理员 · 模板编辑器」）与发布前校验（「管理员 · 模板发布前校验」）；草稿在两页之间共用 */
function TemplatePage({ id }: { id: string }) {
  const isNew = id === 'new';
  const editPath = isNew ? '/templates/new' : `/templates/${id}/edit`;
  const { tab } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const tpl = useQuery({ queryKey: ['template', id], enabled: !isNew, queryFn: () => api<TemplateDetailData>('GET', `/templates/${id}`) });
  const [name, setName] = useState('');
  const nameInputId = useId();
  const [modeControlContainer, setModeControlContainer] = useState<HTMLDivElement | null>(null);
  const [body, setBody] = useState<TemplateBody>(skeleton);
  const [rawValid, setRawValid] = useState(true);
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState<{ body: TemplateBody; name: string; report: ReportItem[]; error?: string }>();
  const [focus, setFocus] = useState<{ where: string }>();
  const [pendingRules, setPendingRules] = useState<Set<string>>(() => new Set());
  const onRuleValidationReady = (id: string, ready: boolean) => setPendingRules(current => {
    const next = new Set(current);
    if (ready) next.delete(id);
    else next.add(id);
    return next;
  });
  const [importing, setImporting] = useState<string>();
  const rulesets = useRuleSetRefs();
  const ctx: ConvertCtx = { rulesets: (rulesets.data ?? []).map(({ id, name }) => ({ id, name })) };
  const [changelog, setChangelog] = useState('');
  const [impact, setImpact] = useState<{ report: ReportItem[]; impact: ImpactEntry[] }>();
  const [confirmed, setConfirmed] = useState(false);
  const users = useQuery({ queryKey: ['users'], enabled: tab === 'publish' && me.data?.role === 'admin', queryFn: () => api<{ users: User[] }>('GET', '/users').then((r) => r.users) });
  const userName = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.username ?? id : '—');

  useEffect(() => {
    const t = tpl.data?.item;
    if (!t) return;
    setName(t.name ?? '');
    setBody({ groups: t.groups, rules: t.rules, final: t.final, ...(t.ruleProviders ? { ruleProviders: t.ruleProviders } : {}) });
  }, [tpl.data]);

  const currentValidation = validation?.body === body && validation.name === name ? validation : undefined;
  const report = [...draftIssues(body), ...(currentValidation?.report ?? [])];
  const errors = report.filter((r) => r.level === 'error');
  // 首次失焦前隐藏新增规则的问题；发布仍使用完整报告，不能绕过校验。
  const visibleReport = report.filter(r => !r.where?.startsWith('rule:') || !pendingRules.has(r.where.slice(5)));
  const visibleErrors = visibleReport.filter(r => r.level === 'error');
  const parseErr = currentValidation?.error;
  const ready = !!currentValidation && !parseErr && rawValid;
  const draft = () => {
    if (!rawValid) throw new Error('请先修复原始配置中的错误');
    if (errors.length) throw new Error(errors.map((r) => r.message).join('；'));
    return { ...body, name };
  };

  // 保留 500ms 防抖；忽略过期响应，防止旧草稿的结果覆盖当前校验。
  useEffect(() => {
    if (!isAdmin || !rawValid || !name.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ report: ReportItem[] }>('POST', '/templates/validate', { ...body, name, ...(isNew ? {} : { id }) }).then(
        (r) => { if (active) setValidation({ body, name, report: r.report }); },
        (e: Error) => { if (active) setValidation({ body, name, report: [], error: e.message }); },
      );
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [body, name, isAdmin, rawValid, id, isNew]);

  useEffect(() => { setImpact(undefined); setConfirmed(false); }, [body, name]);

  const checkImpact = useMutation({
    mutationFn: () => api<{ report: ReportItem[]; impact: ImpactEntry[] }>('POST', `/templates/${id}/impact`, draft()),
    onSuccess: setImpact,
  });
  // 进入发布页且草稿就绪时自动试渲染一次
  useEffect(() => { if (tab === 'publish' && !isNew && ready && !errors.length && !impact && !checkImpact.isPending) checkImpact.mutate(); }, [tab, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const publish = useMutation({ meta: { successMessage: '模板已发布' },
    mutationFn: (force: boolean) => api<{ item: TemplateDoc; impact: ImpactEntry[] }>('POST', `/templates/${id}/publish`, { ...draft(), changelog, force }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template'] });
      setImpact(undefined);
      setChangelog('');
      navigate(`/templates?id=${encodeURIComponent(r.item.id)}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.details && typeof e.details === 'object' && 'impact' in e.details) setImpact(e.details as { report: ReportItem[]; impact: ImpactEntry[] });
    },
  });

  if (me.data && !isAdmin) return <Navigate to={isNew ? '/templates' : `/templates?id=${encodeURIComponent(id)}`} replace />;
  if (!isNew && !tpl.data) return tpl.error ? <ErrorAlert error={tpl.error} /> : <div className="text-muted">加载中…</div>;
  const t = tpl.data?.item;
  const published: TemplateBody | undefined = t && { groups: t.groups, rules: t.rules, final: t.final };
  const changed = !published || JSON.stringify(published) !== JSON.stringify(body) || (t?.name ?? '') !== name;
  const nextVersion = (t?.version ?? 0) + 1;
  const blocking = (impact?.impact ?? []).filter((i) => i.level === 'error');
  const bindingBlocked = blocking.some(i => i.forceable === false);
  const warnings = (impact?.impact ?? []).filter((i) => i.level === 'warn');
  const canPublish = !bindingBlocked && ready && !errors.length && !!name.trim() && !publish.isPending && (!blocking.length || confirmed);
  const crumbs = <><Link to="/templates" className="text-muted no-underline">模板</Link> / {isNew ? '新建' : <Link to={`/templates/${id}`} className="text-muted no-underline">{t?.name ?? id}</Link>}{tab === 'publish' ? ' / 发布' : ''}</>;

  if (tab === 'publish') {
    const diff = published ? templateDiff(published, body) : undefined;
    const lines: [string, string][] = diff ? [
      ...diff.groups.added.map((g) => ['+', `新增组「${g.name}」`] as [string, string]),
      ...diff.groups.removed.map((g) => ['−', `移除组「${g.name}」`] as [string, string]),
      ...diff.groups.modified.map((g) => ['~', `修改组「${g.after.name}」：${g.fields.map((f) => f.field).join('、')}`] as [string, string]),
      ...diff.rules.added.map((r) => ['+', `新增规则 ${matcherLabel(r.matcher, ctx)}`] as [string, string]),
      ...diff.rules.removed.map((r) => ['−', `移除规则 ${matcherLabel(r.matcher, ctx)}`] as [string, string]),
      ...diff.rules.modified.map((r) => ['~', `修改规则 ${matcherLabel(r.after.matcher, ctx)}`] as [string, string]),
      ...(diff.groups.moved.length || diff.rules.moved.length ? [['~', `调整顺序：${diff.groups.moved.length} 个组、${diff.rules.moved.length} 条规则`] as [string, string]] : []),
      ...(diff.final ? [['~', '修改 MATCH 出口'] as [string, string]] : []),
      ...(diff.ruleProviders ? [['~', '修改远程规则来源或顺序'] as [string, string]] : []),
    ] : body.groups.map((g) => ['+', `新增组「${g.name}」`] as [string, string]);
    const own = report.filter((r) => r.level !== 'info');
    return (
      <>
        <PageHeader crumbs={crumbs} title={isNew ? `创建 v1 · ${name || '新模板'}` : `发布 v${nextVersion} · ${name}`}
          subtitle={isNew ? undefined : '发布后立即更新跟随最新版本的配置订阅。'} />
        <PageScroll>
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
              <Card title="① 模板自身" actions={<Badge tone={errors.length || parseErr ? 'err' : ready ? 'ok' : 'neutral'}>{errors.length ? `${errors.length} 个错误` : parseErr ? '校验失败' : ready ? '全部通过' : '校验中…'}</Badge>}>
                <FieldError error={parseErr || (!rawValid ? '编辑器里的 YAML 有错误，请返回编辑器修复。' : undefined)} />
                {own.length ? <TemplateReport items={own} onLocate={(where) => { setFocus({ where }); navigate(editPath); }} />
                  : ready && <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-ink-2">{['出口只指向模板组或内置策略', '组成员不含节点或节点集', '组之间没有循环引用', 'YAML 可以生成并通过结构校验'].map((c) => <li key={c} className="flex gap-2"><span className="text-ok">✓</span>{c}</li>)}</ul>}
              </Card>
              {!isNew && (
                <Card title="② 对现有配置订阅的影响" bodyClass="overflow-x-auto"
                  actions={impact ? <div className="flex gap-2"><Badge tone={blocking.length ? 'err' : 'neutral'}>{blocking.length} 个阻断</Badge><Badge tone={warnings.length ? 'warn' : 'neutral'}>{warnings.length} 个警告</Badge></div>
                    : <Button size="sm" disabled={!ready || errors.length > 0 || checkImpact.isPending} onClick={() => checkImpact.mutate()}>{checkImpact.isPending ? '试渲染中…' : '试渲染'}</Button>}>
                  <ErrorAlert error={checkImpact.error} />
                  {!impact ? <div className="px-4 pb-4 text-[13px] text-muted">{checkImpact.isPending ? '正在对跟随最新版本的配置订阅逐个试渲染…' : '模板自检通过后自动试渲染。'}</div>
                    : !impact.impact.length ? <div className="px-4 pb-4 text-[13px] text-ok">所有跟随最新版本的配置订阅都不受影响。</div> : (
                      <table className="w-full min-w-[640px] border-collapse">
                        <thead><tr><th className={th}>级别</th><th className={th}>配置订阅</th><th className={th}>用户</th><th className={th}>问题</th><th className={cx(th, 'w-px')}><span className="sr-only">操作</span></th></tr></thead>
                        <tbody>
                          {impact.impact.map((i) => (
                            <tr key={i.profileId}>
                              <td className={td}><Badge tone={i.level === 'error' ? 'err' : 'warn'}>{i.level === 'error' ? '阻断' : '警告'}</Badge></td>
                              <td className={cx(td, 'font-medium')}>{i.profileName}</td>
                              <td className={cx(td, 'text-ink-2')}>{userName(i.owner)}</td>
                              <td className={cx(td, 'text-[12.5px]')}>{i.issues.map((x) => x.message).join('；')}</td>
                              <td className={cx(td, 'whitespace-nowrap')}><Link to={`/profiles/${i.profileId}/rules`} className="text-[12.5px] text-accent">跳转</Link></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                </Card>
              )}
            </div>
            <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-4 py-4">
              <h2 className="m-0 text-[15px] font-semibold">{isNew ? 'v1 内容' : `v${t!.version} → v${nextVersion} 变更`}</h2>
              {lines.length ? <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {lines.map(([op, text], i) => <li key={i} className="flex gap-2 text-[13px]"><span className={cx('w-3 shrink-0 font-mono font-semibold', op === '+' ? 'text-ok' : op === '−' ? 'text-err' : 'text-accent')}>{op}</span><span className="min-w-0 break-all">{text}</span></li>)}
              </ul> : <span className="text-[13px] text-muted">与 v{t?.version} 相同，没有需要发布的变更。</span>}
              <Field label="变更说明">{(fid) => <Textarea id={fid} rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)} />}</Field>
              {bindingBlocked && <p className="rounded-lg bg-err-soft p-3 text-[13px]">绑定订阅存在冲突。请先修复成员或引用，再发布模板；不能强制发布。</p>}
              {blocking.length > 0 && !bindingBlocked && <label className="flex items-start gap-2.5 rounded-lg bg-err-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#8f2a1f]">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                我知道 {blocking.map((b) => `「${b.owner ? `${userName(b.owner)} / ` : ''}${b.profileName}」`).join('、')} 将渲染失败；它们会继续返回上一份成功结果，并在其页面提示。
              </label>}
              <ErrorAlert error={publish.error} />
            </aside>
          </div>
        </PageScroll>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant={blocking.length ? 'danger' : 'primary'} disabled={!canPublish || (!isNew && !changed)} onClick={() => publish.mutate(blocking.length > 0)}>
            {publish.isPending ? '发布中…' : bindingBlocked ? '请先修复绑定订阅冲突' : isNew ? '创建 v1' : blocking.length ? (confirmed ? `强制发布 v${nextVersion}` : '存在阻断项，确认后才能发布') : `发布 v${nextVersion}`}
          </Button>
          <Link to={editPath} className={buttonClass()}>返回编辑器</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader crumbs={crumbs} title={isNew ? '新建模板' : name || t?.name || id}
        actions={<>
          <Button disabled={!rawValid} onClick={() => setImporting(templateToYaml(body, ctx))}>从 YAML 导入</Button>
        </>}>
        <Badge tone="accent">{isNew ? '新模板 · 未发布' : changed ? `草稿 · 基于 v${t!.version} · 未发布` : `已发布 v${t!.version}`}</Badge>
      </PageHeader>
      {(visibleErrors.length > 0 || parseErr) && (
        <Notice tone="err" actions={visibleErrors[0]?.where && <Button size="sm" onClick={() => setFocus({ where: visibleErrors[0]!.where! })}>定位</Button>}><span><b>草稿校验：{visibleErrors.length || 1} 个错误。</b>{visibleErrors[0]?.message ?? parseErr}修复前不能发布。</span></Notice>
      )}
      <ol aria-label="模板设置步骤" className="m-0 flex shrink-0 list-none gap-2 p-0">
        {['策略组', '规则'].map((label, index) => <li key={label} className="min-w-0 flex-1">
          <button type="button" aria-current={step === index ? 'step' : undefined} disabled={!rawValid} onClick={() => setStep(index)}
            className={cx('flex min-h-14 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60', step === index ? 'border-accent bg-[#f5f8ff]' : 'border-line bg-panel hover:bg-ground')}>
            <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px]', step === index ? 'bg-accent text-white' : 'bg-[#ebedf1] text-ink-2')}>{index + 1}</span>
            <span className="text-[13.5px] font-semibold">{label}</span>
          </button>
        </li>)}
      </ol>
      <section className="list-panel" aria-label="模板编辑">
        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor={nameInputId} className="text-[12.5px] font-medium text-muted">模板名称</label>
            <div ref={setModeControlContainer} className="min-h-9 shrink-0" />
          </div>
          <Input id={nameInputId} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
          <ErrorAlert error={rulesets.error} />
          <TemplateEditor value={body} onChange={setBody} ctx={ctx} report={visibleReport} focus={focus} onValidityChange={setRawValid} step={step} onStepChange={setStep} modeControlContainer={modeControlContainer} onRuleValidationReady={onRuleValidationReady} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="text-[13px] text-muted">第 {step + 1} 步，共 2 步</span>
          <div className="flex gap-2">
            <Button disabled={step === 0 || !rawValid} onClick={() => setStep(0)}>上一步</Button>
            {step === 0 ? <Button variant="primary" disabled={!rawValid} onClick={() => setStep(1)}>下一步：规则</Button>
              : <Button variant="primary" disabled={!rawValid || !name.trim()} onClick={() => { setPendingRules(new Set()); navigate(isNew ? '/templates/new/publish' : `/templates/${id}/publish`); }}>发布前校验</Button>}
          </div>
        </div>
      </section>
      <Modal title="从 YAML 导入" open={importing !== undefined} onClose={() => setImporting(undefined)} wide
        footer={<><Button onClick={() => setImporting(undefined)}>取消</Button><Button variant="primary" onClick={() => {
          const r = templateFromYaml(importing ?? '', body, ctx);
          if (r.ok) { setBody(r.value); setImporting(undefined); notifySuccess(['模板已导入，发布后生效', ...r.notes].join('\n')); }
          else alertError(r.error);
        }}>导入</Button></>}>
        <Field label="mihomo 的策略组、规则与远程规则来源" hint="可粘贴完整配置：保留组、规则、来源 URL 及其引用顺序，移除单个节点和节点订阅。未引用的来源保留；出口组缺失时须先补齐或更正。独立列表补入组或替换规则，单独导入来源时补入当前模板。">
          {(fid) => <YamlTextarea id={fid} rows={16} className="font-mono text-[12.5px]" spellCheck={false} value={importing ?? ''} onChange={(e) => setImporting(e.target.value)} />}
        </Field>
        {importing !== undefined && (() => { const r = templateFromYaml(importing, body, ctx); return r.ok ? <ul className="m-0 pl-5 text-[13px] text-muted">{r.notes.map((note, i) => <li key={i}>{note}</li>)}</ul> : <FieldError error={`第 ${r.line ?? 1} 行：${r.error}`} />; })()}
      </Modal>
    </>
  );
}
