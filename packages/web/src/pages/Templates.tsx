// 模板：所有人在列表页浏览（组骨架、规则、版本记录）；管理员在详情页编辑并发布新版本。
// 表单与 mihomo YAML 共用草稿，修改后即时校验（TPL-11）；发布前分析影响（TPL-07）。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportItem } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, type ImpactEntry } from '../api.ts';
import { memberLabel, targetLabel } from '../components/pickers.tsx';
import { Badge, Button, buttonClass, Card, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Textarea, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useMe, useTemplates, type TemplateDoc } from '../hooks.ts';
import { newId, type ConvertCtx, type TemplateBody } from '../convert/templateYaml.ts';
import { TemplateEditor } from './template/TemplateEditor.tsx';
import { TemplateDiff } from './template/TemplateDiff.tsx';
import { matcherLabel, TemplateReport } from './template/TemplateFields.tsx';
import { draftIssues } from './template/model.ts';

type TemplateDetailData = { item: TemplateDoc; versions: { version: number; changelog?: string; createdAt: number }[] };

/** 模板浏览（设计稿「模板 · 普通用户浏览」）：左侧模板列表，右侧选中模板的骨架、规则与版本 */
export function TemplateList() {
  const list = useTemplates();
  const isAdmin = useMe().data?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const profiles = useList('profiles');
  const sel = list.data?.find((t) => t.id === params.get('id')) ?? list.data?.[0];
  const inUse = (id: string) => (profiles.data ?? []).filter((p) => p.template?.id === id).length;
  return (
    <>
      <PageHeader title="模板" subtitle="管理员维护的分流骨架：策略组和规则，不含节点。配置订阅选择一个模板，再填充自己的节点。"
        actions={isAdmin && <Link to="/templates/new" className={buttonClass('primary')}><Plus size={16} />新建模板</Link>} />
      <ErrorBox error={list.error} />
      {list.isLoading ? <div className="text-muted">加载中…</div> : !list.data?.length ? (
        <section className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel px-7 py-7 text-center">
          <span className="text-[14px] font-semibold">还没有模板</span>
          <span className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">{isAdmin ? '新建一个模板：定义策略组骨架和规则，用户的配置订阅会以它为基础。' : '管理员还没有发布模板。'}</span>
        </section>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <nav aria-label="模板列表" className="min-w-0 flex-[1_1_260px] overflow-hidden rounded-[10px] border border-line bg-panel py-1.5">
            {list.data.map((t) => {
              const on = t.id === sel?.id;
              const n = inUse(t.id);
              return (
                <button key={t.id} type="button" aria-current={on || undefined} onClick={() => setParams({ id: t.id }, { replace: true })}
                  className={cx('flex w-full cursor-pointer flex-col gap-1 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'bg-panel hover:bg-ground')}>
                  <span className="flex justify-between gap-2"><span className="text-[13.5px] font-semibold">{t.name ?? t.id}</span><span className="font-mono text-[12px] text-muted">v{t.version}</span></span>
                  <span className="text-[12px] text-muted">{t.groups.length} 个策略组 · {t.rules.length} 条规则</span>
                  <span className="text-[12px] text-ink-2">{n ? `你有 ${n} 个配置订阅在用` : '未使用'}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
            {sel && <TemplateDetail key={sel.id} id={sel.id} inUse={inUse(sel.id)} actions={<>
              {isAdmin && <Link to={`/templates/${sel.id}`} className={buttonClass()}>编辑新版本</Link>}
              <Link to={`/profiles/new?template=${encodeURIComponent(sel.id)}`} className={buttonClass('primary')}>用这个模板新建配置订阅</Link>
            </>} />}
          </div>
        </div>
      )}
    </>
  );
}

const RULE_PREVIEW = 8;

/** 模板详情：头部卡片、策略组骨架、规则（默认显示前几条）、版本记录与对比 */
function TemplateDetail({ id, inUse, actions }: { id: string; inUse?: number; actions?: ReactNode }) {
  const tpl = useQuery({ queryKey: ['template', id], queryFn: () => api<TemplateDetailData>('GET', `/templates/${id}`) });
  const rulesets = useList('rulesets');
  const bundles = useList('bundles');
  const ctx: ConvertCtx = { rulesets: (rulesets.data ?? []).map(({ id, name }) => ({ id, name })), bundles: (bundles.data ?? []).map(({ id, name }) => ({ id, name })) };
  const [allRules, setAllRules] = useState(false);
  const [diffVersion, setDiffVersion] = useState<number>();
  if (!tpl.data) return tpl.error ? <ErrorBox error={tpl.error} /> : <div className="text-muted">加载中…</div>;
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
      <Card title="策略组骨架" actions={<span className="text-[12.5px] text-muted">节点由你在配置订阅里填充</span>} bodyClass="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>组</th><th className={th}>类型</th><th className={th}>成员（组 / 内置）</th><th className={th}>为空时</th><th className={th}>填充提示</th></tr></thead>
          <tbody>
            {t.groups.map((g) => (
              <tr key={g.id}>
                <td className={cx(td, 'font-medium whitespace-nowrap')}>{g.name}</td>
                <td className={cx(td, 'font-mono text-[12.5px]')}>{g.type}</td>
                <td className={cx(td, 'text-[12.5px] text-ink-2')}>{g.members.map((m) => memberLabel(m, groupName, nsName).text).join(' · ') || '—'}</td>
                <td className={cx(td, 'text-ink-2 whitespace-nowrap')}>{emptyText(g)}</td>
                <td className={cx(td, 'text-muted')}>{g.hint ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap items-start gap-5">
        <Card title="规则" className="min-w-0 flex-[999_1_420px]" actions={<span className="text-[12.5px] text-muted">{t.rules.length} 条{!allRules && t.rules.length > RULE_PREVIEW ? ` · 显示前 ${RULE_PREVIEW} 条` : ''}</span>} bodyClass="pb-1">
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
          <ul className="m-0 flex list-none flex-col p-0">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-col gap-1 border-t border-line-2 py-2.5 first:border-0 first:pt-0">
                <span className="flex justify-between text-[13px]"><span className="font-mono font-semibold">v{v.version}</span><span className="text-[12px] text-muted">{formatTime(v.createdAt).slice(5, 10)}</span></span>
                <span className="text-[12.5px] leading-relaxed text-ink-2">{v.changelog ?? '—'}</span>
                {v.version > 1 && <button type="button" className="w-fit cursor-pointer text-[12.5px] text-accent" onClick={() => setDiffVersion(v.version)}>与上一版对比</button>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {diffVersion !== undefined && <TemplateDiff id={id} version={diffVersion} ctx={ctx} onClose={() => setDiffVersion(undefined)} />}
    </>
  );
}

function skeleton(): TemplateBody {
  const id = newId('g');
  return {
    groups: [{ id, name: '🚀 节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }], hint: '建议放所有节点', whenEmpty: 'reject' }],
    rules: [], final: { kind: 'group', groupId: id },
  };
}

export function TemplateEdit() {
  const { id = 'new' } = useParams();
  return <TemplatePage key={id} id={id} />;
}

function TemplatePage({ id }: { id: string }) {
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useMe().data?.role === 'admin';
  const tpl = useQuery({ queryKey: ['template', id], enabled: !isNew, queryFn: () => api<{ item: TemplateDoc; versions: { version: number; changelog?: string; createdAt: number }[] }>('GET', `/templates/${id}`) });
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [name, setName] = useState('');
  const [body, setBody] = useState<TemplateBody>(skeleton);
  const [rawValid, setRawValid] = useState(true);
  const [validation, setValidation] = useState<{ body: TemplateBody; name: string; report: ReportItem[]; error?: string }>();
  const [focus, setFocus] = useState<{ where: string }>();
  const rulesets = useList('rulesets');
  const bundles = useList('bundles');
  const ctx: ConvertCtx = { rulesets: (rulesets.data ?? []).map(({ id, name }) => ({ id, name })), bundles: (bundles.data ?? []).map(({ id, name }) => ({ id, name })) };
  const [changelog, setChangelog] = useState('');
  const [impact, setImpact] = useState<{ report: ReportItem[]; impact: ImpactEntry[] }>();
  const [confirmForce, setConfirmForce] = useState(false);

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
    if (mode !== 'edit' || !isAdmin || !rawValid || !name.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ report: ReportItem[] }>('POST', '/templates/validate', { ...body, name }).then(
        (r) => { if (active) setValidation({ body, name, report: r.report }); },
        (e: Error) => { if (active) setValidation({ body, name, report: [], error: e.message }); },
      );
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [body, name, mode, isAdmin, rawValid]);

  useEffect(() => { setImpact(undefined); setConfirmForce(false); }, [body, name]);

  const checkImpact = useMutation({
    mutationFn: () => api<{ report: ReportItem[]; impact: ImpactEntry[] }>('POST', `/templates/${id}/impact`, draft()),
    onSuccess: setImpact,
  });
  const publish = useMutation({
    mutationFn: (force: boolean) => api<{ item: TemplateDoc; impact: ImpactEntry[] }>('POST', `/templates/${id}/publish`, { ...draft(), changelog, force }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template'] });
      setConfirmForce(false);
      setImpact(undefined);
      setChangelog('');
      setMode('view');
      if (isNew) navigate(`/templates/${r.item.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setImpact(e.details as { report: ReportItem[]; impact: ImpactEntry[] });
        setConfirmForce(true);
      }
    },
  });

  if (!isNew && !tpl.data) return tpl.error ? <ErrorBox error={tpl.error} /> : <div className="text-muted">加载中…</div>;
  const t = tpl.data?.item;
  const blocking = (impact?.impact ?? []).filter((i) => i.level === 'error');

  return (
    <>
      <PageHeader crumbs={<><Link to="/templates" className="text-muted no-underline">模板</Link> / {isNew ? '新建' : t?.name ?? id}</>}
        title={isNew ? '新建模板' : t?.name ?? id}
        actions={isAdmin && !isNew && <Segmented label="模式" value={mode} options={[{ value: 'view', label: '查看' }, { value: 'edit', label: '编辑新版本' }]} onChange={(next) => { if (rawValid) setMode(next); }} />}>
        {t && <Badge tone="accent">v{t.version}</Badge>}
      </PageHeader>

      {mode === 'view' && t && <TemplateDetail id={id} />}

      {mode === 'edit' && isAdmin && (
        <div className="flex flex-wrap items-start gap-5">
          <Card title="编辑" className="min-w-0 flex-[999_1_560px]">
            <div className="flex flex-col gap-3.5">
              <Field label="名称">{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <ErrorBox error={rulesets.error || bundles.error} />
              <TemplateEditor value={body} onChange={setBody} ctx={ctx} report={report} focus={focus} onValidityChange={setRawValid} />
            </div>
          </Card>
          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
            <Card title="模板自检" actions={<Badge tone={errors.length ? 'err' : ready ? 'ok' : 'neutral'}>{errors.length ? `${errors.length} 个错误` : ready ? '通过' : '待校验'}</Badge>}>
              <ErrorBox error={parseErr || (!rawValid ? '请先修复原始配置中的错误，再定位或发布。' : undefined)} />
              {(ready || report.length > 0) && <TemplateReport items={report} onLocate={(where) => { if (rawValid) setFocus({ where }); }} />}
              {!ready && !parseErr && rawValid && <span className="text-[13px] text-muted">{name.trim() ? '修改后自动校验…' : '请填写模板名称'}</span>}
            </Card>
            <Card title="发布">
              <div className="flex flex-col gap-3">
                <Field label="变更说明">{(fid) => <Textarea id={fid} rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)} />}</Field>
                {!isNew && <Button onClick={() => checkImpact.mutate()} disabled={!ready || errors.length > 0 || checkImpact.isPending}>{checkImpact.isPending ? '分析中…' : '分析对现有配置订阅的影响'}</Button>}
                {impact && (
                  impact.impact.length === 0 ? <span className="text-[13px] text-ok">所有跟随最新版本的配置订阅都不受影响。</span> : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {impact.impact.map((i) => (
                        <li key={i.profileId} className="flex flex-col gap-1 rounded-lg border border-line p-2.5">
                          <span className="flex items-center gap-2"><Badge tone={i.level === 'error' ? 'err' : 'warn'}>{i.level === 'error' ? '阻断' : '警告'}</Badge><Link to={`/profiles/${i.profileId}`} className="font-medium text-accent no-underline hover:underline">{i.profileName}</Link></span>
                          {i.issues.map((x, k) => <span key={k} className="text-[12.5px] text-ink-2">{x.message}</span>)}
                        </li>
                      ))}
                    </ul>
                  )
                )}
                <ErrorBox error={checkImpact.error} />
                <ErrorBox error={publish.error && !(publish.error instanceof ApiError && publish.error.status === 409) ? publish.error : undefined} />
                <Button variant="primary" onClick={() => publish.mutate(false)} disabled={!ready || errors.length > 0 || !name.trim() || publish.isPending}>
                  {publish.isPending ? '发布中…' : isNew ? '创建 v1' : `发布 v${(t?.version ?? 0) + 1}`}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Modal title="存在阻断项" open={confirmForce} onClose={() => setConfirmForce(false)}
        footer={<><Button onClick={() => setConfirmForce(false)}>返回修改</Button><Button variant="danger" onClick={() => publish.mutate(true)} disabled={!ready || errors.length > 0 || publish.isPending}>强制发布</Button></>}>
        <p className="m-0 text-[13.5px] leading-relaxed">{blocking.length} 个配置订阅会在新版本下渲染失败。强制发布后，这些订阅会继续返回上一份成功结果，并在其页面提示。</p>
        <ul className="m-0 pl-5 text-[13px]">{blocking.map((b) => <li key={b.profileId}><Link to={`/profiles/${b.profileId}`} className="text-accent">{b.profileName}</Link>：{b.issues.map((x) => x.message).join('；')}</li>)}</ul>
      </Modal>
    </>
  );
}
