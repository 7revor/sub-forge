import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { CodePreview } from '../components/CodePreview.tsx';
// 规则集（RS-01–04、CR-05）：一个规则集由多个来源（远程地址 / 本地规则）合并而成，只配一个出口。
// 来源配置与本地内容就地编辑，下方始终只读预览最终合并结果。

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Client, Platform, RuleSetFormat } from '@sub-forge/core';
import { FileText, Globe, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type RulesetPreview, type RulesetSourceStatus } from '../api.ts';
import { RulesetOverrides, overridesError } from '../components/RulesetOverrides.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorBox, Field, Input, Select, Switch, Textarea, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import type { RuleSetDoc, RuleSetSourceDoc } from '../hooks.ts';
import { newId } from '../convert/templateYaml.ts';

const FORMATS: { value: RuleSetFormat; label: string }[] = [
  { value: 'auto', label: '自动识别' }, { value: 'classical', label: 'classical 文本' }, { value: 'domain-set', label: 'Surge DOMAIN-SET' },
  { value: 'ipcidr', label: '纯 CIDR' }, { value: 'yaml', label: 'mihomo YAML payload' }, { value: 'mrs', label: 'mrs（透传）' },
];
const FORMAT_TEXT: Record<string, string> = { auto: '自动识别', classical: 'classical', 'domain-set': 'DOMAIN-SET', domain: 'DOMAIN-SET', ipcidr: 'CIDR', yaml: 'YAML payload', mrs: 'mrs', srs: 'srs' };
const isPassthrough = (s: RuleSetSourceDoc) => s.format === 'mrs' || s.format === 'srs';
const sourceLabel = (s: RuleSetSourceDoc) => s.name?.trim() || (s.kind === 'remote' ? s.url || '远程地址' : '本地规则');

function sourceSummary(rs: RuleSetDoc): string {
  const remote = rs.sources.filter((s) => s.kind === 'remote').length;
  const local = rs.sources.length - remote;
  return [remote && `${remote} 个远程`, local && `${local} 个本地`].filter(Boolean).join(' · ') || '没有来源';
}

export function RulesetList() {
  return (
    <DocList kind="rulesets" title="规则集"
      columns={[
        { header: '名称', cell: (r) => r.name },
        { header: '备注', cell: (r) => <NoteCell note={r.note} /> },
        { header: '来源', cell: (r) => <span className="text-ink-2">{sourceSummary(r)}</span> },
        { header: 'IP 类 no-resolve', cell: (r) => (r.noResolve ? '是' : '否') },
      ]} />
  );
}

const newLocal = (): RuleSetSourceDoc => ({ id: newId('src'), kind: 'local', format: 'auto', content: '' });
const newRemote = (): RuleSetSourceDoc => ({ id: newId('src'), kind: 'remote', format: 'auto', url: '' });
const FIRST_SOURCE = 'src_first';
const EMPTY_RS: RuleSetDoc = { id: '', name: '', sources: [{ ...newLocal(), id: FIRST_SOURCE }] };

const TARGETS: { key: string; client: Client; platform?: Platform; label: string }[] = [
  { key: 'mihomo', client: 'mihomo', label: 'mihomo' },
  { key: 'mihomo-android', client: 'mihomo', platform: 'android', label: 'mihomo Android' },
  { key: 'surge-macos', client: 'surge', platform: 'macos', label: 'Surge macOS' },
  { key: 'surge-ios', client: 'surge', platform: 'ios', label: 'Surge iOS' },
];

function rulesetError(d: RuleSetDoc): string | undefined {
  if (!d.name.trim()) return '请填写名称。';
  if (!d.sources.length) return '至少添加一个来源。';
  for (const [i, s] of d.sources.entries()) {
    const at = `来源 ${i + 1}「${sourceLabel(s)}」`;
    if (s.kind === 'remote' && !/^https?:\/\/[^/]+/.test(s.url ?? '')) return `${at}：请填写 http(s) 地址。`;
    if (s.format === 'mrs' && s.behavior !== 'domain' && s.behavior !== 'ipcidr') return `${at}：mrs 需要选择 behavior。`;
  }
  return overridesError(d.overrides ?? []);
}

/** 规则集（设计稿「规则集」）：来源 → 客户端改写（整个规则集）→ 输出预览，每块独占一行 */
export function RulesetEdit() {
  const e = useDocEditor('rulesets', EMPTY_RS);
  const [target, setTarget] = useState('mihomo');
  const [selected, setSelected] = useState<string | undefined>(() => (e.isNew ? FIRST_SOURCE : undefined));
  const [showError, setShowError] = useState(false);
  const t = TARGETS.find((x) => x.key === target)!;
  const draft = useDebouncedValue(e.draft, 400);
  const preview = useQuery({
    queryKey: ['ruleset-preview', e.isNew ? '' : e.id, target, JSON.stringify(draft)],
    enabled: !!draft,
    placeholderData: keepPreviousData,
    queryFn: () => api<RulesetPreview>('POST', '/rulesets/preview', {
      ...(e.isNew ? {} : { id: e.id }), ruleset: draft,
      client: t.client, ...(t.platform ? { platform: t.platform } : {}),
    }),
  });
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const setSource = (id: string, p: Partial<RuleSetSourceDoc>) => set({ sources: d.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const add = (src: RuleSetSourceDoc) => { set({ sources: [...d.sources, src] }); setSelected(src.id); };
  const status = new Map((preview.data?.sources ?? []).map((s) => [s.id, s]));
  const failing = d.sources.filter((s) => s.kind === 'remote' && status.get(s.id)?.error).length;
  const error = rulesetError(d);

  return (
    <DetailShell listPath="/rulesets" listLabel="规则集" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => {
        setShowError(true);
        if (!error) e.submit((x) => ({ ...x, sources: x.sources.map(({ url, content, fetch, ...s }) => (s.kind === 'remote' ? { ...s, url, ...(fetch ? { fetch } : {}) } : { ...s, content: content ?? '' })) }));
      }}
      saveError={(showError && error) || e.save.error}
      onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      badges={!e.isNew && <>
        <Badge>{sourceSummary(d)}</Badge>
        {failing > 0 && <Badge tone="err">{failing} 个来源拉取失败</Badge>}
        {failing === 0 && d.sources.some((s) => s.kind === 'remote' && status.get(s.id)?.ok) && <Badge tone="ok">拉取成功</Badge>}
      </>}>
      <Card title="基本信息" bodyClass="flex flex-col gap-4 px-4 pb-4">
        <Field label="名称">{(id) => <Input id={id} autoFocus={e.isNew} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>
        <NoteField value={d.note} onChange={(note) => set({ note })} />
      </Card>
      <Card title="来源" actions={<>
        <Button className="h-9" onClick={() => add(newRemote())}><Globe size={15} />添加远程地址</Button>
        <Button className="h-9" onClick={() => add(newLocal())}><FileText size={15} />添加本地规则</Button>
        {!e.isNew && <Link to={`/rule-repo?ruleset=${encodeURIComponent(d.id)}`} className={buttonClass('default', 'md', 'h-9')}>从规则仓库添加</Link>}
      </>}>
        <div className="flex flex-col gap-4">
          {!d.sources.length ? <Empty title="还没有来源" /> : (
            <SortableList items={d.sources} getKey={(s) => s.id} onReorder={(sources) => set({ sources })} renderItem={(s, _i, handle) => (
              <SourceRow src={s} handle={handle} active={s.id === selected} status={status.get(s.id)} loading={preview.isFetching}
                onSelect={() => setSelected(s.id === selected ? undefined : s.id)}
                onChange={(p) => setSource(s.id, p)}
                onDelete={() => { set({ sources: d.sources.filter((x) => x.id !== s.id) }); if (s.id === selected) setSelected(undefined); }} />
            )} />
          )}
          <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="h-[18px] w-[18px] accent-accent" checked={!!d.noResolve} onChange={(x) => set({ noResolve: x.target.checked || undefined })} />IP 类规则统一加 <span className="font-mono">no-resolve</span></label>
        </div>
      </Card>

      <RulesetOverrides value={d.overrides ?? []} legacySources={d.sources}
        onChange={(overrides) => set({ overrides: overrides.length ? overrides : undefined })}
        onRemoveLegacy={(id) => setSource(id, { overrides: undefined })} />

      <Card className="min-w-0" title="最终结果（只读）">
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="客户端与平台" className="flex flex-wrap gap-1.5">
            {TARGETS.map((x) => <button key={x.key} type="button" aria-pressed={x.key === target} onClick={() => setTarget(x.key)}
              className={cx('h-[34px] cursor-pointer rounded-full border px-3 text-[12.5px]', x.key === target ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink hover:bg-ground')}>{x.label}</button>)}
          </div>
          {preview.data?.stats && <MergedStats stats={preview.data.stats} />}
          <PreviewBody preview={preview} />
          {!!preview.data?.passthroughSources?.length && <span className="text-[12.5px] text-muted">另有 {preview.data.passthroughSources.map((p) => `「${p.name}」`).join('')}以透传方式单独输出。</span>}
        </div>
      </Card>
    </DetailShell>
  );
}

function SourceRow({ src, handle, active, status, loading, onSelect, onChange, onDelete }: {
  src: RuleSetSourceDoc; handle: ReactNode; active: boolean; status?: RulesetSourceStatus; loading: boolean;
  onSelect: () => void; onChange: (p: Partial<RuleSetSourceDoc>) => void; onDelete: () => void;
}) {
  const on = src.enabled !== false;
  const label = sourceLabel(src);
  const lines = src.kind === 'local' ? (src.content ?? '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length : undefined;
  const sub = src.kind === 'remote'
    ? [src.name?.trim() && src.url, `远程 · ${FORMAT_TEXT[src.format] ?? src.format}`].filter(Boolean).join(' · ')
    : `本地 · ${FORMAT_TEXT[src.format] ?? src.format} · ${lines} 行`;
  return (
    <div className={cx('my-2 rounded-lg border', active ? 'border-accent bg-[#f8faff]' : 'border-line', !on && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-3 pl-2">
        {handle}
        <button type="button" aria-pressed={active} onClick={onSelect} className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left">
          <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-md', src.kind === 'remote' ? 'bg-accent-soft text-accent-ink' : 'bg-[#ebedf1] text-ink-2')} aria-hidden="true">
            {src.kind === 'remote' ? <Globe size={15} /> : <FileText size={15} />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cx('truncate text-[13.5px] font-medium', src.kind === 'remote' && !src.name?.trim() && 'font-mono text-[12.5px]')}>{label}</span>
            <span className="truncate text-[12px] text-muted">{sub}</span>
          </span>
        </button>
        <SourceStatus src={src} status={status} loading={loading} />
        <Switch label={`启用 ${label}`} checked={on} onChange={(v) => onChange({ enabled: v ? undefined : false })} />
        <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`删除 ${label}`} onClick={onDelete}><Trash2 size={14} /></Button>
      </div>
      {active && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 border-t border-line-2 px-4 pt-3 pb-3.5">
          {src.kind === 'remote' && <Field label="地址" className="col-span-full">{(id) => <Input id={id} autoFocus={!src.url} className="font-mono" placeholder="https://" value={src.url ?? ''} onChange={(x) => onChange({ url: x.target.value })} />}</Field>}
          <Field label="格式">{(id) => <Select id={id} value={src.format} onChange={(x) => onChange({ format: x.target.value as RuleSetFormat })}>{FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>}</Field>
          {src.format === 'mrs' && <Field label="behavior" hint="mrs 无法解析，必须声明">{(id) => <Select id={id} value={src.behavior ?? ''} onChange={(x) => onChange({ behavior: (x.target.value || undefined) as 'domain' | 'ipcidr' | undefined })}><option value="">请选择</option><option value="domain">domain</option><option value="ipcidr">ipcidr</option></Select>}</Field>}
          {src.kind === 'remote' && <Field label="缓存（小时）">{(id) => <Input id={id} type="number" min={1} step={1} value={Math.round((src.fetch?.ttlSec ?? 86400) / 3600)} onChange={(x) => {
            const h = Number(x.target.value);
            const { ttlSec: _, ...rest } = src.fetch ?? {};
            onChange({ fetch: h > 0 && h !== 24 ? { ...rest, ttlSec: h * 3600 } : Object.keys(rest).length ? rest : undefined });
          }} />}</Field>}
          {src.kind === 'local' && !isPassthrough(src) && <Field className="col-span-full" label="本地规则内容" hint="每行一条，支持 classical 规则、域名或 CIDR。">{(id) => (
            <Textarea id={id} rows={10} spellCheck={false} className="min-h-[220px] font-mono text-[12.5px]" value={src.content ?? ''} onChange={(x) => onChange({ content: x.target.value })} />
          )}</Field>}
        </div>
      )}
    </div>
  );
}

function SourceStatus({ src, status, loading }: { src: RuleSetSourceDoc; status?: RulesetSourceStatus; loading: boolean }) {
  if (isPassthrough(src)) return <Badge>透传</Badge>;
  if (!status) return loading ? <Badge>检查中…</Badge> : null;
  if (status.error) return <span title={status.error}><Badge tone="err">{src.kind === 'remote' ? '拉取失败' : '无法读取'}</Badge></span>;
  if (status.rules === undefined) return null;
  return <Badge tone={status.rejected ? 'warn' : 'neutral'}>{status.rules} 条{status.rejected ? ` · 不支持 ${status.rejected} 行` : ''}</Badge>;
}

function MergedStats({ stats }: { stats: NonNullable<RulesetPreview['stats']> }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {(['domain', 'classical', 'ipcidr'] as const).map((b) => <div key={b} className="flex flex-col gap-0.5 rounded-lg bg-ground p-2.5"><span className="font-mono text-[11.5px] text-muted">{b}</span><span className="text-xl font-semibold">{stats[b]}</span></div>)}
      </div>
      <span className="text-[12.5px] text-ink-2">来源与改写共 {stats.total} 条，去重 {stats.duplicates} 条，输出 {stats.total - stats.duplicates} 条</span>
    </div>
  );
}

function PreviewBody({ preview }: { preview: UseQueryResult<RulesetPreview> }) {
  if (preview.error) return <ErrorBox error={preview.error} />;
  const p = preview.data;
  if (!p) return <div className="text-[13px] text-muted">加载中…</div>;
  return (
    <>
      {p.error && <ErrorBox error={`拉取失败：${p.error}`} />}
      {p.lines.length ? <CodePreview text={p.lines.join('\n')} loading={preview.isFetching} bodyClassName="min-h-[120px]" /> : <Empty title="没有可输出的规则" />}
      <span className="text-[12px] text-muted">{p.total ?? p.lines.length} 行{(p.total ?? 0) > p.lines.length ? `（显示前 ${p.lines.length} 行）` : ''} · 降级 {p.notes?.length ?? 0} · 丢弃 {p.dropped.length} · 无法解析 {p.rejected.length}</span>
      {[...(p.notes ?? []).map((n) => ['降级', n]), ...p.dropped.map((x) => ['丢弃', x.reason]), ...p.rejected.map((x) => ['不支持', `第 ${x.line} 行 ${x.text}：${x.reason}`])].slice(0, 50).map(([k, v], i) => (
        <div key={i} className="flex gap-2 text-[12.5px]"><Badge tone={k === '降级' ? 'accent' : k === '丢弃' ? 'err' : 'warn'}>{k}</Badge><span className="min-w-0 break-all">{v}</span></div>
      ))}
    </>
  );
}
