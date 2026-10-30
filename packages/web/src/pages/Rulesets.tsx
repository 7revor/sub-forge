import { useQuery } from '@tanstack/react-query';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { api } from '../api.ts';
import { RuleCard } from '../components/RuleCard.tsx';
import { RuleSourcePreview } from '../components/RuleSourcePreview.tsx';
import { RulesetSourceDialog } from '../components/RulesetSourceDialog.tsx';
import { RepositoryMatchHint } from '../components/RepositoryMatchHint.tsx';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches, type RepositoryUrlMatch } from '../hooks/useRepositoryUrlMatches.ts';
import { alertError } from '../feedback.ts';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { RulesetPreview } from '../components/RulesetPreview.tsx';
import { RejectedRulesPopover } from '../components/RejectedRulesPopover.tsx';
// 规则集（RS-01–04、CR-05）：一个规则集由多个来源（远程地址 / 本地规则）合并而成，只配一个出口。
// 来源正文打开只读预览，编辑使用统一弹窗；下方始终显示合并结果。

import { FileText, Globe, Link2, ScanSearch } from 'lucide-react';
import { useRef, useState } from 'react';
import type { RulesetSourceStatus } from '../api.ts';
import { RulesetOverrides, overridesError } from '../components/RulesetOverrides.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, Card, ErrorAlert, FieldError, Field, Input, buttonClass } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import type { RuleSetDoc, RuleSetSourceDoc } from '../hooks.ts';
import { newId } from '../convert/templateYaml.ts';
import { localRuleLines } from '@sub-forge/core';

const isBinary = (s: RuleSetSourceDoc) => s.format === 'mrs' || s.format === 'srs';
const sourceLabel = (s: RuleSetSourceDoc) => s.name?.trim() || (s.kind === 'remote' ? s.url || '远程地址' : localRuleLines(s.content ?? '')[0]?.text ?? '尚未填写');

function sourceSummary(rs: RuleSetDoc): string {
  const remote = rs.sources.filter((s) => s.kind === 'remote').length;
  const linked = rs.sources.filter(s => s.repository).length;
  const local = rs.sources.length - remote;
  return [linked && `${linked} 个关联`, (remote - linked) > 0 && `${remote - linked} 个远程`, local && `${local} 个本地`].filter(Boolean).join(' · ') || '没有来源';
}

export function RulesetList() {
  return (
    <DocList kind="rulesets" title="增强集合"
      columns={[
        { header: '名称', cell: (r) => r.name },
        { header: '备注', cell: (r) => <NoteCell note={r.note} /> },
        { header: '来源', cell: (r) => <span className="text-ink-2">{sourceSummary(r)}</span> },
      ]} />
  );
}

const newLocal = (): RuleSetSourceDoc => ({ id: newId('src'), kind: 'local', format: 'auto', content: '' });
const newRemote = (): RuleSetSourceDoc => ({ id: newId('src'), kind: 'remote', format: 'auto', url: '' });
const EMPTY_RS: RuleSetDoc = { id: '', name: '', sources: [] };
const sourceActionClass = buttonClass('default', 'sm', 'w-full min-w-0 whitespace-normal max-sm:gap-1.5 max-sm:px-2');

function rulesetError(d: RuleSetDoc): string | undefined {
  if (!d.name.trim()) return '请填写名称。';
  if (!d.sources.length) return '至少添加一个来源。';
  for (const [i, s] of d.sources.entries()) {
    const at = `来源 ${i + 1}「${sourceLabel(s)}」`;
    if (s.kind === 'remote' && !/^https?:\/\/[^/]+/.test(s.url ?? '')) return `${at}：请填写 http(s) 地址。`;
  }
  return overridesError(d.overrides ?? []);
}

/** 规则集（设计稿「规则集」）：来源 → 客户端改写（整个规则集）→ 输出预览，每块独占一行 */
export function RulesetEdit() {
  const e = useDocEditor('rulesets', EMPTY_RS);
  const permission = useQuery({ queryKey: ['ruleset-permission', e.id], enabled: !e.isNew && !!e.id, queryFn: () => api<{ writable: boolean }>('GET', `/rulesets/${e.id}`).then(r => r.writable) });
  const canEdit = e.isNew || permission.data === true;
  const [linking, setLinking] = useState<string>();
  const [linkError, setLinkError] = useState<string>();
  const matches = useRepositoryUrlMatches();
  const sources = useRulesetSources(e.isNew ? undefined : e.id, e.draft);
  const latest = useRef(e.draft); latest.current = e.draft;
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const status = sources.statuses;
  const error = rulesetError(d);
  const urls = d.sources.flatMap(s => s.kind === 'remote' && !s.repository && s.url ? [s.url] : []);
  const edit = async (editing: { source: RuleSetSourceDoc; adding: boolean; repository?: boolean }) => {
    const result = await RulesetSourceDialog.show(editing);
    if (result.status !== 'confirmed') return;
    const source = result.data, current = latest.current;
    if (!current) return;
    e.setDraft({ ...current, sources: editing.adding ? [...current.sources, source] : current.sources.map(s => s.id === editing.source.id ? source : s) });
    if (editing.source.url && editing.source.url !== source.url) matches.clear([editing.source.url]);
    if (editing.adding && source.kind === 'remote' && !source.repository && source.url) void matches.detect([source.url]);
  };
  const link = async (id: string, url: string, match: RepositoryUrlMatch) => {
    setLinking(id); setLinkError(undefined);
    try {
      const resolved = await resolveRepositoryUrlMatch(url, match);
      const next = resolved.repository?.sources[0];
      const current = latest.current;
      if (!next || !current?.sources.some(s => s.id === id && s.url === url && !s.repository)) return;
      e.setDraft({ ...current, sources: current.sources.map(s => s.id === id ? { ...s, ...next, id: newId('src') } : s) });
      matches.clear([url]);
    } catch (cause) { setLinkError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLinking(undefined); }
  };
  return <DetailShell canEdit={canEdit} listPath="/rulesets" listLabel="增强集合" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
    extraActions={!e.isNew && <ResourceLinkButton kind="rulesets" id={d.id} name={d.name} disabled={e.dirty} />}
    onSave={() => {
      if (error) { alertError(error); return; }
      e.submit(x => ({ ...x, sources: x.sources.map(({ url, content, fetch, ...s }) => s.kind === 'remote' ? { ...s, url, ...(fetch ? { fetch } : {}) } : { ...s, content: content ?? '' }) }));
    }} saveError={e.save.error} onDelete={e.remove} onDeleted={e.afterRemove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
    badges={!e.isNew && <Badge>{sourceSummary(d)}</Badge>}>
    {!canEdit && <p className="text-[13px] text-ink-muted">公共规则增强 · 仅创建者或管理员可以修改</p>}
    <fieldset disabled={!canEdit} className="contents">
    <Card title="基本信息" bodyClass="flex flex-col gap-4 px-4 pb-4">
      <Field label="名称">{id => <Input placeholder="填写用于区分规则集的名称" id={id} autoFocus={e.isNew} value={d.name} onChange={event => set({ name: event.target.value })} />}</Field>
      <NoteField value={d.note} onChange={note => set({ note })} />
    </Card>
    </fieldset>
    {canEdit ? <>
    <Card title="来源" actions={<Button size="sm" disabled={!urls.length || matches.isPending} onClick={() => void matches.detect(urls)}><ScanSearch size={15} />{matches.isPending ? '检测中…' : '检测仓库关联'}</Button>}>
      <ErrorAlert error={matches.error} /><FieldError error={linkError} />
      <div role="group" aria-label="添加规则来源" className="grid grid-cols-3 gap-2">
        <Button size="sm" className={sourceActionClass} onClick={() => void edit({ source: newRemote(), adding: true, repository: true })}><Link2 size={14} className="hidden sm:block" />关联规则集合</Button>
        <Button size="sm" className={sourceActionClass} onClick={() => void edit({ source: newRemote(), adding: true })}><Globe size={14} className="hidden sm:block" />添加远程地址</Button>
        <Button size="sm" className={sourceActionClass} onClick={() => void edit({ source: newLocal(), adding: true })}><FileText size={14} className="hidden sm:block" />添加本地规则</Button>
      </div>
      <SortableList items={d.sources} getKey={s => s.id} onReorder={sources => set({ sources })} renderItem={(s, i, handle) => <RuleCard label={`第 ${i + 1} 项来源`} handle={handle}
        icon={s.repository ? <Link2 size={16} /> : s.kind === 'remote' ? <Globe size={16} /> : <FileText size={16} />}
        count={<SourceStatus src={s} status={status.get(s.id)} loading={sources.loading.has(s.id)} />}
        hint={s.kind === 'remote' && !s.repository && s.url && <RepositoryMatchHint matches={matches.matches[s.url] ?? []} busy={!!linking} onLink={match => link(s.id, s.url!, match)} />}
        onPreview={() => void RuleSourcePreview.show({ source: { rulesetId: e.isNew ? undefined : e.id, source: s } })} onEdit={() => void edit({ source: s, adding: false })} onDelete={() => { set({ sources: d.sources.filter(x => x.id !== s.id) }); if (s.url) matches.clear([s.url]); }}>
        <span title={sourceLabel(s)}>{sourceLabel(s)}</span>
      </RuleCard>} />
    </Card>
    </> : <Card title="来源（只读）"><div className="flex flex-col gap-2">{d.sources.map((source, i) => <Button key={source.id} onClick={() => void RuleSourcePreview.show({ source: { rulesetId: e.id, source } })}>查看来源 {i + 1} · {sourceLabel(source)}</Button>)}</div></Card>}
    <fieldset disabled={!canEdit} className="contents">
    <RulesetOverrides value={d.overrides ?? []} legacySources={d.sources} onChange={overrides => set({ overrides: overrides.length ? overrides : undefined })}
      onRemoveLegacy={id => set({ sources: d.sources.map(s => s.id === id ? { ...s, overrides: undefined } : s) })} />
    </fieldset>
    <Card className="min-w-0" title="合并结果（只读）">
      <RulesetPreview key={e.id} inputs={sources.inputs} ready={sources.ready} sourceReading={sources.reading} onRefreshSources={sources.refresh}
        overrides={d.overrides} sourceError={sources.error} sourceNames={Object.fromEntries(d.sources.map(s => [s.id, sourceLabel(s)]))} />
    </Card>
  </DetailShell>;
}

function SourceStatus({ src, status, loading }: { src: RuleSetSourceDoc; status?: RulesetSourceStatus; loading: boolean }) {
  if (isBinary(src)) return <Badge>二进制托管</Badge>;
  if (!status) return loading ? <Badge>检查中…</Badge> : null;
  if (status.error) return <span title={status.error}><Badge tone="err">{src.kind === 'remote' ? '拉取失败' : '无法读取'}</Badge></span>;
  if (status.rules === undefined) return null;
  if (status.rejected) return <RejectedRulesPopover sourceName={sourceLabel(src)} status={status} />;
  return <Badge>{status.rules} 条</Badge>;
}
