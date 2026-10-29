import { usePagedList } from '../hooks/usePagedList.ts';
import { Pagination } from '../components/Pagination.tsx';
import { alertError, notifySuccess } from '../feedback.ts';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { Notice } from '../components/Notice.tsx';
import { VersionHistory } from './template/VersionHistory.tsx';
// 模板：所有人在列表页浏览（组骨架、规则、版本记录）；管理员在详情页编辑并发布新版本。
// 表单与 mihomo YAML 共用草稿，修改后即时校验（TPL-11）；发布前分析影响（TPL-07）。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportItem } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, type ImpactEntry, type User } from '../api.ts';
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

/** 管理员模板列表：左侧选择模板，右侧查看骨架、规则与版本，并进入编辑或发布。 */
export function TemplateList() {
  const list = usePagedList('templates');
  const [params, setParams] = useSearchParams();
  const profiles = useList('profiles');
  const selId = params.get('id') ?? list.data?.items[0]?.id;
  const inUse = (id: string) => (profiles.data ?? []).filter((p) => p.template?.id === id).length;
  return (
    <>
      <PageHeader title="模板"
        actions={<Link to="/templates/new" className={buttonClass('primary')}><Plus size={16} />新建模板</Link>} />
      <ErrorAlert error={list.error} />
      <div className="template-list-layout grid min-w-0 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
        <section className="list-panel" aria-busy={list.isFetching}>
          <div className="shrink-0 px-4 py-3.5"><Input aria-label="搜索模板" placeholder="搜索名称" value={list.q} onChange={e => list.setQ(e.target.value)} /></div>
          <nav key={`${list.data?.page}-${list.pageSize}-${list.q}`} aria-label="模板列表" className="min-h-0 flex-1 overflow-auto overscroll-contain">
            {!list.data ? <div className="p-4 text-muted">{list.error ? '列表加载失败，请重试。' : '加载中…'}{list.error && <Button size="sm" onClick={() => void list.refetch()}>重试</Button>}</div> : !list.data.items.length ? <Empty title={list.q.trim() ? `没有名称包含「${list.q.trim()}」的模板` : '还没有模板'} /> : list.data.items.map(t => {
              const on = t.id === selId;
              const n = inUse(t.id);
              return (
                <button key={t.id} type="button" aria-current={on || undefined} onClick={() => setParams(previous => {
                  const next = new URLSearchParams(previous); next.set('id', t.id); return next;
                }, { replace: true })}
                  className={cx('flex w-full cursor-pointer flex-col gap-1 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'bg-panel hover:bg-ground')}>
                  <span className="flex justify-between gap-2"><span className="text-[13.5px] font-semibold">{t.name ?? t.id}</span><span className="font-mono text-[12px] text-muted">v{t.version}</span></span>
                  <span className="text-[12px] text-muted">{t.groups.length} 个策略组 · {t.rules.length} 条规则</span>
                  <span className="text-[12px] text-ink-2">{n ? `你有 ${n} 个配置订阅在用` : '未使用'}</span>
                </button>
              );
            })}
          </nav>
          <Pagination compact page={list.data?.page ?? list.page} pageSize={list.pageSize} total={list.data?.total ?? 0} totalPages={list.data?.totalPages ?? 1}
            busy={list.isFetching || !list.data} onPage={list.setPage} onPageSize={list.setPageSize} />
        </section>
        <div className="min-h-0 min-w-0 overflow-auto overscroll-contain">
          <div className="flex min-w-0 flex-col gap-5">
            {selId && <TemplateDetail key={selId} id={selId} inUse={inUse(selId)} actions={<>
              <Link to={`/templates/${selId}`} className={buttonClass()}>编辑新版本</Link>
              <Link to={`/templates/${selId}/publish`} className={buttonClass()}>发布</Link>
              <Link to={`/profiles/new?template=${encodeURIComponent(selId)}`} className={buttonClass('primary')}>用这个模板新建配置订阅</Link>
            </>} />}
          </div>
        </div>
      </div>
    </>
  );
}

const RULE_PREVIEW = 8;

/** 模板详情：头部卡片、策略组骨架、规则（默认显示前几条）、版本记录与对比 */
function TemplateDetail({ id, inUse, actions }: { id: string; inUse?: number; actions?: ReactNode }) {
  const tpl = useQuery({ queryKey: ['template', id], queryFn: () => api<TemplateDetailData>('GET', `/templates/${id}`) });
  const rulesets = useRuleSetRefs();
  const ctx: ConvertCtx = { rulesets: (rulesets.data ?? []).map(({ id, name }) => ({ id, name })) };
  const [allRules, setAllRules] = useState(false);
  const [diffVersion, setDiffVersion] = useState<number>();
  if (!tpl.data) return tpl.error ? <ErrorAlert error={tpl.error} /> : <div className="text-muted">加载中…</div>;
  const { item: t, versions } = tpl.data;
  const groupName = (gid: string) => t.groups.find((g) => g.id === gid)?.name ?? gid;
  const nsName = () => '';
  const published = versions.find((v) => v.version === t.version)?.createdAt;
  const rules = allRules ? t.rules : t.rules.slice(0, RULE_PREVIEW);
  const emptyText = (g: TemplateDoc['groups'][number]) => (g.whenEmpty === 'direct' ? 'DIRECT' : '拒绝');
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-panel px-4.5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[17px] font-semibold">{t.name ?? t.id} <span className="font-mono text-[13px] font-medium text-muted">v{t.version}</span></h2>
          <span className="text-[12.5px] text-muted">{t.groups.length} 个策略组 · {t.rules.length} 条规则{published ? ` · 发布于 ${formatTime(published).slice(5, 10)}` : ''}{inUse !== undefined ? ` · 你有 ${inUse} 个配置订阅在用` : ''}</span>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </section>
      <Card title="策略组骨架" bodyClass="overflow-x-auto">
        {!t.groups.length ? <div className="px-4 pb-4"><Empty title="还没有组" /></div> : <table className="w-full border-collapse">
          <thead><tr><th className={th}>组</th><th className={th}>类型</th><th className={th}>成员（组 / 内置）</th><th className={th}>为空时</th></tr></thead>
          <tbody>
            {t.groups.map((g) => (
              <tr key={g.id}>
                <td className={cx(td, 'font-medium whitespace-nowrap')}>{g.name}</td>
                <td className={cx(td, 'font-mono text-[12.5px]')}>{g.type}</td>
                <td className={cx(td, 'text-[12.5px] text-ink-2')}>{g.members.map((m) => memberLabel(m, groupName, nsName).text).join(' · ') || '—'}</td>
                <td className={cx(td, 'text-ink-2 whitespace-nowrap')}>{emptyText(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </Card>
      <div className="flex flex-wrap items-start gap-5">
        <Card title="规则" className="min-w-0 flex-[999_1_420px]" actions={<span className="text-[12.5px] text-muted">{t.rules.length} 条{!allRules && t.rules.length > RULE_PREVIEW ? ` · 显示前 ${RULE_PREVIEW} 条` : ''}</span>} bodyClass="pb-1">
          {!rules.length && <div className="px-4 pb-4"><Empty title="没有规则" description="未匹配的流量走 MATCH。" /></div>}
          {rules.map((r, i) => (
            <div key={r.id} className="grid grid-cols-[28px_minmax(0,1.4fr)_16px_minmax(0,0.8fr)] items-center gap-2 border-t border-line-2 px-4 py-2.5 text-[13px]">
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
              <span className="truncate font-mono text-[12.5px]">{matcherLabel(r.matcher, ctx)}</span>
              <span aria-hidden="true" className="text-faint">→</span>
              <span className="truncate">{targetLabel(r.target, groupName, nsName)}</span>
            </div>
          ))}
          {(allRules || t.rules.length <= RULE_PREVIEW) && (
            <div className="grid grid-cols-[28px_minmax(0,1.4fr)_16px_minmax(0,0.8fr)] items-center gap-2 border-t border-line-2 px-4 py-2.5 text-[13px]">
              <span className="font-mono text-[12px] text-muted">—</span><span className="font-mono text-[12.5px]">MATCH</span><span aria-hidden="true" className="text-faint">→</span><span>{targetLabel(t.final, groupName, nsName)}</span>
            </div>
          )}
          {t.rules.length > RULE_PREVIEW && <div className="border-t border-line-2 px-4 py-2.5"><button type="button" className="cursor-pointer text-[13px] text-accent" onClick={() => setAllRules(!allRules)}>{allRules ? '收起' : `展开全部 ${t.rules.length} 条`}</button></div>}
        </Card>
        <Card title="版本记录" className="min-w-0 flex-[1_1_260px]">
          <VersionHistory versions={versions} onCompare={setDiffVersion} dateOnly />
        </Card>
      </div>
      {diffVersion !== undefined && <TemplateDiff id={id} version={diffVersion} ctx={ctx} onClose={() => setDiffVersion(undefined)} />}
    </>
  );
}

function skeleton(): TemplateBody {
  const id = newId('g');
  return {
    groups: [{ id, name: '节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }], whenEmpty: 'reject' }],
    rules: [], final: { kind: 'group', groupId: id },
  };
}

export function TemplateEdit() {
  const { id = 'new' } = useParams();
  return <TemplatePage key={id} id={id} />;
}

/** 管理员编辑模板（设计稿「管理员 · 模板编辑器」）与发布前校验（「管理员 · 模板发布前校验」）；草稿在两页之间共用 */
function TemplatePage({ id }: { id: string }) {
  const isNew = id === 'new';
  const { tab } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const tpl = useQuery({ queryKey: ['template', id], enabled: !isNew, queryFn: () => api<TemplateDetailData>('GET', `/templates/${id}`) });
  const [name, setName] = useState('');
  const [body, setBody] = useState<TemplateBody>(skeleton);
  const [rawValid, setRawValid] = useState(true);
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState<{ body: TemplateBody; name: string; report: ReportItem[]; error?: string }>();
  const [focus, setFocus] = useState<{ where: string }>();
  const [diffVersion, setDiffVersion] = useState<number>();
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
    setBody({ groups: t.groups, rules: t.rules, final: t.final });
  }, [tpl.data]);

  const currentValidation = validation?.body === body && validation.name === name ? validation : undefined;
  const report = [...draftIssues(body), ...(currentValidation?.report ?? [])];
  const errors = report.filter((r) => r.level === 'error');
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
      if (e instanceof ApiError && e.status === 409) setImpact(e.details as { report: ReportItem[]; impact: ImpactEntry[] });
    },
  });

  if (me.data && !isAdmin) return <Navigate to={isNew ? '/templates' : `/templates?id=${encodeURIComponent(id)}`} replace />;
  if (!isNew && !tpl.data) return tpl.error ? <ErrorAlert error={tpl.error} /> : <div className="text-muted">加载中…</div>;
  const t = tpl.data?.item;
  const published: TemplateBody | undefined = t && { groups: t.groups, rules: t.rules, final: t.final };
  const changed = !published || JSON.stringify(published) !== JSON.stringify(body) || (t?.name ?? '') !== name;
  const nextVersion = (t?.version ?? 0) + 1;
  const blocking = (impact?.impact ?? []).filter((i) => i.level === 'error');
  const warnings = (impact?.impact ?? []).filter((i) => i.level === 'warn');
  const canPublish = ready && !errors.length && !!name.trim() && !publish.isPending && (!blocking.length || confirmed);
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
                {own.length ? <TemplateReport items={own} onLocate={(where) => { setFocus({ where }); navigate(`/templates/${id}`); }} />
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
              {blocking.length > 0 && <label className="flex items-start gap-2.5 rounded-lg bg-err-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#8f2a1f]">
                <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                我知道 {blocking.map((b) => `「${b.owner ? `${userName(b.owner)} / ` : ''}${b.profileName}」`).join('、')} 将渲染失败；它们会继续返回上一份成功结果，并在其页面提示。
              </label>}
              <ErrorAlert error={publish.error && !(publish.error instanceof ApiError && publish.error.status === 409) ? publish.error : undefined} />
            </aside>
          </div>
        </PageScroll>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant={blocking.length ? 'danger' : 'primary'} disabled={!canPublish || (!isNew && !changed)} onClick={() => publish.mutate(blocking.length > 0)}>
            {publish.isPending ? '发布中…' : isNew ? '创建 v1' : blocking.length ? (confirmed ? `强制发布 v${nextVersion}` : '存在阻断项，确认后才能发布') : `发布 v${nextVersion}`}
          </Button>
          <Link to={isNew ? '/templates/new' : `/templates/${id}`} className={buttonClass()}>返回编辑器</Link>
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
      {(errors.length > 0 || parseErr) && (
        <Notice tone="err" actions={errors[0]?.where && <Button size="sm" onClick={() => setFocus({ where: errors[0]!.where! })}>定位</Button>}><span><b>草稿校验：{errors.length || 1} 个错误。</b>{errors[0]?.message ?? parseErr}修复前不能发布。</span></Notice>
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
      <div className="page-scroll !mb-0"><div className="page-scroll-content flex flex-col gap-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card bodyClass="p-4"><Field label="模板名称">{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}</Field></Card>
          <Card title="模板自检" actions={<Badge tone={errors.length ? 'err' : ready ? 'ok' : 'neutral'}>{errors.length ? `${errors.length} 个错误` : ready ? '通过' : '待校验'}</Badge>}>
            {(ready || report.length > 0) && <TemplateReport items={report} onLocate={(where) => { if (rawValid) setFocus({ where }); }} />}
            {!ready && !parseErr && rawValid && <span className="text-[13px] text-muted">{name.trim() ? '修改后自动校验…' : '请填写模板名称'}</span>}
          </Card>
        </div>
        <ErrorAlert error={rulesets.error} />
        <TemplateEditor value={body} onChange={setBody} ctx={ctx} report={report} focus={focus} onValidityChange={setRawValid} step={step} onStepChange={setStep} />
        {!isNew && <details className="rounded-[10px] border border-line bg-panel p-4">
          <summary className="cursor-pointer text-[13px] font-medium">版本记录</summary>
          <div className="pt-3"><VersionHistory versions={tpl.data!.versions} onCompare={setDiffVersion} /></div>
        </details>}
      </div></div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-muted">第 {step + 1} 步，共 2 步</span>
        <div className="flex gap-2">
          <Button disabled={step === 0 || !rawValid} onClick={() => setStep(0)}>上一步</Button>
          {step === 0 ? <Button variant="primary" disabled={!rawValid} onClick={() => setStep(1)}>下一步：规则</Button>
            : <Button variant="primary" disabled={!rawValid || !name.trim()} onClick={() => navigate(isNew ? '/templates/new/publish' : `/templates/${id}/publish`)}>发布前校验</Button>}
        </div>
      </div>
      {diffVersion !== undefined && <TemplateDiff id={id} version={diffVersion} ctx={ctx} onClose={() => setDiffVersion(undefined)} />}
      <Modal title="从 YAML 导入" open={importing !== undefined} onClose={() => setImporting(undefined)} wide
        footer={<><Button onClick={() => setImporting(undefined)}>取消</Button><Button variant="primary" onClick={() => {
          const r = templateFromYaml(importing ?? '', body, ctx);
          if (r.ok) { setBody(r.value); setImporting(undefined); notifySuccess('模板已导入，发布后生效'); }
          else alertError(r.error);
        }}>导入</Button></>}>
        <Field label="mihomo 的 proxy-groups 与 rules（不含节点）" hint="完整配置替换组与规则；策略组列表补入当前组，规则列表替换当前规则。">
          {(fid) => <YamlTextarea id={fid} rows={16} className="font-mono text-[12.5px]" spellCheck={false} value={importing ?? ''} onChange={(e) => setImporting(e.target.value)} />}
        </Field>
        {importing !== undefined && (() => { const r = templateFromYaml(importing, body, ctx); return r.ok ? null : <FieldError error={`第 ${r.line ?? 1} 行：${r.error}`} />; })()}
      </Modal>
    </>
  );
}
