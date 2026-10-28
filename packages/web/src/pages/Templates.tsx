// 模板：所有人可浏览（组骨架、规则、版本记录）；管理员编辑并发布新版本。
// 编辑器用 JSON 编辑 groups / rules / final，修改后即时校验（TPL-11）；发布前先看对现有配置订阅的影响（TPL-07）。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportItem } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, type ImpactEntry } from '../api.ts';
import { memberLabel, targetLabel } from '../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, ReportList, Segmented, Textarea, formatTime, td, th } from '../components/ui.tsx';
import { useMe, useTemplates, type TemplateDoc } from '../hooks.ts';
import { ruleText } from './profile/TabRules.tsx';

export function TemplateList() {
  const list = useTemplates();
  const isAdmin = useMe().data?.role === 'admin';
  return (
    <>
      <PageHeader title="模板" actions={isAdmin && <Link to="/templates/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-white no-underline hover:bg-accent-strong"><Plus size={16} />新建模板</Link>} />
      <p className="m-0 -mt-2 text-[13.5px] text-muted">模板只包含分流：策略组骨架 + 规则 + 二者的关联。配置订阅跟随最新版本时，模板发布后立即生效。</p>
      <ErrorBox error={list.error} />
      <Card bodyClass="overflow-x-auto">
        {!list.data?.length ? <div className="p-4"><Empty>还没有模板。</Empty></div> : (
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>名称</th><th className={th}>版本</th><th className={th}>组</th><th className={th}>规则</th></tr></thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id} className="hover:bg-ground">
                  <td className={td}><Link to={`/templates/${t.id}`} className="font-medium text-ink no-underline hover:text-accent">{t.name ?? t.id}</Link></td>
                  <td className={`${td} font-mono`}>v{t.version}</td>
                  <td className={`${td} font-mono`}>{t.groups.length}</td>
                  <td className={`${td} font-mono`}>{t.rules.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

const SKELETON = {
  groups: [
    { id: 'sel', name: '🚀 节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }], hint: '建议放所有节点' },
  ],
  rules: [],
  final: { kind: 'group', groupId: 'sel' },
};

function TemplateView({ t }: { t: TemplateDoc }) {
  const groupName = (id: string) => t.groups.find((g) => g.id === id)?.name ?? id;
  const nsName = () => '';
  return (
    <div className="flex flex-wrap items-start gap-5">
      <Card title="策略组骨架" className="min-w-0 flex-[1_1_420px]" bodyClass="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>组</th><th className={th}>类型</th><th className={th}>成员</th><th className={th}>为空时</th></tr></thead>
          <tbody>
            {t.groups.map((g) => (
              <tr key={g.id}>
                <td className={td}><div className="flex flex-col gap-0.5"><span className="font-medium">{g.name}</span>{g.hint && <span className="text-[12px] text-muted">{g.hint}</span>}</div></td>
                <td className={`${td} font-mono text-[12.5px]`}>{g.type}</td>
                <td className={`${td} text-[12.5px] text-ink-2`}>{g.members.map((m) => memberLabel(m, groupName, nsName).text).join(' · ') || '—'}</td>
                <td className={td}><Badge tone={g.whenEmpty === 'direct' ? 'accent' : 'err'}>{g.whenEmpty === 'direct' ? '直连' : '拒绝'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="规则" className="min-w-0 flex-[1_1_420px]" bodyClass="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>#</th><th className={th}>匹配项</th><th className={th}>出口</th></tr></thead>
          <tbody>
            {t.rules.map((r, i) => (
              <tr key={r.id}>
                <td className={`${td} font-mono text-muted`}>{i + 1}</td>
                <td className={`${td} font-mono text-[12.5px]`}>{r.matcher.kind === 'rule' ? ruleText(r.matcher.rule) : `${r.matcher.kind === 'ruleset' ? '规则集' : '规则包'} ${r.matcher.id}`}</td>
                <td className={td}>{targetLabel(r.target, groupName, nsName)}</td>
              </tr>
            ))}
            <tr><td className={`${td} font-mono text-muted`}>—</td><td className={`${td} font-mono`}>MATCH</td><td className={td}>{targetLabel(t.final, groupName, nsName)}</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function TemplateEdit() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useMe().data?.role === 'admin';
  const tpl = useQuery({ queryKey: ['template', id], enabled: !isNew, queryFn: () => api<{ item: TemplateDoc; versions: { version: number; changelog?: string; createdAt: number }[] }>('GET', `/templates/${id}`) });
  const [mode, setMode] = useState<'view' | 'edit'>(isNew ? 'edit' : 'view');
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [parseErr, setParseErr] = useState('');
  const [report, setReport] = useState<ReportItem[]>();
  const [changelog, setChangelog] = useState('');
  const [impact, setImpact] = useState<{ report: ReportItem[]; impact: ImpactEntry[] }>();
  const [confirmForce, setConfirmForce] = useState(false);

  useEffect(() => {
    const t = tpl.data?.item;
    const src = t ? { groups: t.groups, rules: t.rules, final: t.final } : SKELETON;
    setName(t?.name ?? '');
    setJson(JSON.stringify(src, null, 2));
  }, [tpl.data]);

  const draft = (): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(json) as Record<string, unknown>;
      return { ...v, name };
    } catch { return undefined; }
  };

  // 编辑时即时校验（防抖）
  useEffect(() => {
    if (mode !== 'edit' || !isAdmin) return;
    const t = setTimeout(() => {
      const d = draft();
      if (!d) { setParseErr('JSON 无效'); return; }
      setParseErr('');
      api<{ report: ReportItem[] }>('POST', '/templates/validate', d).then((r) => setReport(r.report), (e: Error) => setParseErr(e.message));
    }, 500);
    return () => clearTimeout(t);
  }, [json, name, mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const errors = (report ?? []).filter((r) => r.level === 'error');
  const blocking = (impact?.impact ?? []).filter((i) => i.level === 'error');

  return (
    <>
      <PageHeader crumbs={<><Link to="/templates" className="text-muted no-underline">模板</Link> / {isNew ? '新建' : t?.name ?? id}</>}
        title={isNew ? '新建模板' : t?.name ?? id}
        actions={isAdmin && !isNew && <Segmented label="模式" value={mode} options={[{ value: 'view', label: '查看' }, { value: 'edit', label: '编辑新版本' }]} onChange={setMode} />}>
        {t && <Badge tone="accent">v{t.version}</Badge>}
      </PageHeader>

      {mode === 'view' && t && (
        <>
          <TemplateView t={t} />
          <Card title="版本记录">
            <ul className="m-0 flex list-none flex-col p-0">
              {tpl.data!.versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-baseline gap-3 border-t border-line-2 py-2.5 first:border-0">
                  <span className="font-mono font-semibold">v{v.version}</span><span className="text-[12px] text-muted">{formatTime(v.createdAt)}</span><span className="text-[13px]">{v.changelog ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {mode === 'edit' && isAdmin && (
        <div className="flex flex-wrap items-start gap-5">
          <Card title="编辑" className="min-w-0 flex-[999_1_560px]">
            <div className="flex flex-col gap-3.5">
              <Field label="名称">{(fid) => <Input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="groups / rules / final（JSON）" hint={parseErr ? <span className="text-err">{parseErr}</span> : '组成员只能是模板组或内置策略；规则出口只能是模板组或内置策略；不能预设 filter'}>
                {(fid) => <Textarea id={fid} rows={24} spellCheck={false} className="font-mono text-[12.5px] leading-[1.6]" value={json} onChange={(e) => setJson(e.target.value)} />}
              </Field>
            </div>
          </Card>
          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
            <Card title="模板自检" actions={report && <Badge tone={errors.length ? 'err' : 'ok'}>{errors.length ? `${errors.length} 个错误` : '通过'}</Badge>}>
              {report ? <ReportList items={report} /> : <span className="text-[13px] text-muted">修改后自动校验</span>}
            </Card>
            <Card title="发布">
              <div className="flex flex-col gap-3">
                <Field label="变更说明">{(fid) => <Textarea id={fid} rows={3} value={changelog} onChange={(e) => setChangelog(e.target.value)} />}</Field>
                {!isNew && <Button onClick={() => checkImpact.mutate()} disabled={!!parseErr || errors.length > 0 || checkImpact.isPending}>{checkImpact.isPending ? '分析中…' : '分析对现有配置订阅的影响'}</Button>}
                {impact && (
                  impact.impact.length === 0 ? <span className="text-[13px] text-ok">所有跟随最新版本的配置订阅都不受影响。</span> : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {impact.impact.map((i) => (
                        <li key={i.profileId} className="flex flex-col gap-1 rounded-lg border border-line p-2.5">
                          <span className="flex items-center gap-2"><Badge tone={i.level === 'error' ? 'err' : 'warn'}>{i.level === 'error' ? '阻断' : '警告'}</Badge><span className="font-medium">{i.profileName}</span></span>
                          {i.issues.map((x, k) => <span key={k} className="text-[12.5px] text-ink-2">{x.message}</span>)}
                        </li>
                      ))}
                    </ul>
                  )
                )}
                <ErrorBox error={publish.error && !(publish.error instanceof ApiError && publish.error.status === 409) ? publish.error : undefined} />
                <Button variant="primary" onClick={() => publish.mutate(false)} disabled={!!parseErr || errors.length > 0 || !name.trim() || publish.isPending}>
                  {publish.isPending ? '发布中…' : isNew ? '创建 v1' : `发布 v${(t?.version ?? 0) + 1}`}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Modal title="存在阻断项" open={confirmForce} onClose={() => setConfirmForce(false)}
        footer={<><Button onClick={() => setConfirmForce(false)}>返回修改</Button><Button variant="danger" onClick={() => publish.mutate(true)} disabled={publish.isPending}>强制发布</Button></>}>
        <p className="m-0 text-[13.5px] leading-relaxed">{blocking.length} 个配置订阅会在新版本下渲染失败。强制发布后，这些订阅会继续返回上一份成功结果，并在其页面提示。</p>
        <ul className="m-0 pl-5 text-[13px]">{blocking.map((b) => <li key={b.profileId}>{b.profileName}：{b.issues.map((x) => x.message).join('；')}</li>)}</ul>
      </Modal>
    </>
  );
}
