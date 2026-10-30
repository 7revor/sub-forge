import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { LoonImport as ImportPlan, Client, ReportItem } from '@sub-forge/core';
import { api } from '../../api.ts';
import { useLeaveGuard } from '../../hooks/useLeaveGuard.ts';
import { Button, ErrorAlert, Field, Input, PageHeader, PageScroll } from '../../components/ui.tsx';
import { YamlTextarea } from '../../components/YamlTextarea.tsx';

type Preview = { plan: ImportPlan; clients?: Record<Client, ReportItem[]>; remoteChecked: false };
export function LoonImportPage() {
  const [name, setName] = useState(''), [text, setText] = useState(''), [final, setFinal] = useState('');
  const [checked, setChecked] = useState('');
  const query = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { leave } = useLeaveGuard(!!text.trim(), undefined, () => ({ what: 'Loon 导入草稿', canSave: false, onSave: async () => { throw new Error('请先在导入页预览并创建订阅'); } }));
  const body = { name, text, ...(final.trim() ? { final: final.trim() } : {}) }, key = JSON.stringify(body);
  const preview = useMutation({ mutationFn: (input: typeof body) => api<Preview>('POST', '/profiles/import/loon', input) });
  const save = useMutation({ mutationFn: (input: typeof body) => api<{ item: { id: string } }>('POST', '/profiles/import/loon', { ...input, save: true }), onSuccess: async result => { await query.invalidateQueries(); if (mounted.current) leave('/profiles/' + result.item.id + '/overview'); } });
  const current = checked === key ? preview.data : undefined, busy = preview.isPending || save.isPending;
  return <>
    <PageHeader title="导入 Loon 完整配置" crumbs={<Link to="/profiles">配置订阅</Link>} actions={<Button variant="primary" disabled={busy || !current || current.plan.report.some(r => r.level === 'error')} onClick={() => save.mutate(body)}>创建配置订阅</Button>} />
    <PageScroll><div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p className="text-[13px] text-ink-muted">解析基础设置、节点、远程订阅、筛选器、策略组、代理链与规则。预览不拉取远程订阅；创建后由现有资源流程更新。各端兼容报告仅覆盖已提供的本地内容。</p>
      <fieldset disabled={busy} className="m-0 flex flex-col gap-4 border-0 p-0">
        <Field label="订阅名称">{id => <Input id={id} placeholder="填写导入后的配置订阅名称" value={name} onChange={e => setName(e.target.value)} />}</Field>
        <Field label="Loon 配置原文">{id => <YamlTextarea id={id} rows={18} spellCheck={false} placeholder="粘贴包含 [General]、[Proxy]、[Proxy Group] 等段落的 Loon 配置" value={text} onChange={e => setText(e.target.value)} />}</Field>
        <Field label="缺少 FINAL 时的最终出口" hint="原文已有 FINAL 时使用原文。缺少时须明确填写已声明的节点、策略组、DIRECT 或 REJECT。">{id => <Input id={id} placeholder="原文缺少 FINAL 时填写最终出口名称" value={final} onChange={e => setFinal(e.target.value)} />}</Field>
        <Button disabled={!name.trim() || !text.trim()} onClick={() => { setChecked(key); preview.mutate(body); }}>预览导入结果</Button>
      </fieldset>
      <ErrorAlert error={preview.error || save.error} />
      {current && <section aria-label="导入预览" className="rounded-lg border border-line p-4 text-[13px]">
        <p>本地节点组 {current.plan.locals.length} · 远程来源 {current.plan.sources.length} · 筛选组合 {current.plan.collections.length} · 代理链 {current.plan.profile.chains.length}</p>
        {current.plan.report.map((r, i) => <p key={i} className={r.level === 'error' ? 'text-err' : 'text-ink-muted'}>{r.level === 'error' ? '错误：' : '提示：'}{r.where ? r.where + ' · ' : ''}{r.message}</p>)}
        {current.clients && Object.entries(current.clients).map(([client, reports]) => <details key={client} className="my-2"><summary>{client}：{reports.filter(r => r.level === 'error').length} 项不兼容，{reports.filter(r => r.level === 'warn').length} 项提示</summary>{reports.map((r, i) => <p key={i} className={r.level === 'error' ? 'text-err' : 'text-ink-muted'}>{r.where ? r.where + ' · ' : ''}{r.message}</p>)}</details>)}
      </section>}
    </div></PageScroll>
  </>;
}
