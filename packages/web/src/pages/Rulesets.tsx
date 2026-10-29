// 规则集（RS-01–04、CR-05）：一个规则集由多个来源（远程地址 / 本地规则）合并而成，只配一个出口。
// 新建与编辑共用同一页面：来源列表在第一块直接编辑；点选来源时下方预览该来源（本地规则可实时编辑），
// 不选时预览合并后的最终规则。原「规则包」已并入规则集（2026-10-29）。

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Client, Platform, RuleSetFormat } from '@sub-forge/core';
import { FileText, Globe, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type RulesetPreview, type RulesetSourceStatus } from '../api.ts';
import { RulesetOverrides, overridesError } from '../components/RulesetOverrides.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorBox, Field, Input, Select, Switch, Textarea, cx } from '../components/ui.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
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
    <DocList kind="rulesets" title="规则集" empty="一组匹配条件，可以由多个远程地址与本地规则合并而成，在配置订阅的规则里配上出口。" intro="一组匹配条件（不含出口），可以引用多个远程地址与本地规则，合并去重后只配一个出口；管理员名下的规则集可被所有人引用。"
      columns={[
        { header: '名称', cell: (r) => r.name },
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

/** 编辑中的草稿停顿后才请求预览，避免每次按键都打到服务端 */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

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
  const [renaming, setRenaming] = useState(false);
  const [showError, setShowError] = useState(false);
  const t = TARGETS.find((x) => x.key === target)!;
  const draft = useDebounced(e.draft, 400);
  const preview = useQuery({
    queryKey: ['ruleset-preview', e.isNew ? '' : e.id, selected, target, JSON.stringify(draft)],
    // 新加的来源要等防抖后的草稿里有它再请求，否则服务端找不到该来源
    enabled: !!draft && (!selected || draft.sources.some((s) => s.id === selected)),
    placeholderData: keepPreviousData,
    queryFn: () => api<RulesetPreview>('POST', '/rulesets/preview', {
      ...(e.isNew ? {} : { id: e.id }), ruleset: draft, ...(selected ? { source: selected } : {}),
      client: t.client, ...(t.platform ? { platform: t.platform } : {}),
    }),
  });
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const setSource = (id: string, p: Partial<RuleSetSourceDoc>) => set({ sources: d.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const add = (src: RuleSetSourceDoc) => { set({ sources: [...d.sources, src] }); setSelected(src.id); };
  const current = d.sources.find((s) => s.id === selected);
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
      actionItems={[{ label: '重命名', onSelect: () => setRenaming(true) }]}
      badges={!e.isNew && <>
        <Badge>{sourceSummary(d)}</Badge>
        {failing > 0 && <Badge tone="err">{failing} 个来源拉取失败</Badge>}
        {failing === 0 && d.sources.some((s) => s.kind === 'remote' && status.get(s.id)?.ok) && <Badge tone="ok">拉取成功</Badge>}
      </>}>
      <Card title="来源" actions={<>
        <Button className="h-9" onClick={() => add(newRemote())}><Globe size={15} />添加远程地址</Button>
        <Button className="h-9" onClick={() => add(newLocal())}><FileText size={15} />添加本地规则</Button>
        {!e.isNew && <Link to={`/rule-repo?ruleset=${encodeURIComponent(d.id)}`} className={buttonClass('default', 'md', 'h-9')}>从规则仓库添加</Link>}
      </>}>
        <div className="flex flex-col gap-3">
          {e.isNew && <Field label="名称">{(id) => <Input id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>}
          <p className="m-0 text-[12.5px] text-muted">可以引用多个远程地址与本地规则，合并去重后在规则列表里只占一行、只配一个出口。点击来源在下方预览它的输出，本地规则可在预览里直接编辑；不选中时预览合并后的最终规则。</p>
          {!d.sources.length ? <Empty title="还没有来源" description="添加远程地址或本地规则。" /> : (
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

      <Card className="min-w-0" title={<h2 className="m-0 min-w-0 truncate text-[15px] font-semibold">{current ? `输出预览 · ${sourceLabel(current)}` : '输出预览 · 合并结果'}</h2>}
        actions={current && <Button size="sm" onClick={() => setSelected(undefined)}>查看合并结果</Button>}>
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="客户端与平台" className="flex flex-wrap gap-1.5">
            {TARGETS.map((x) => <button key={x.key} type="button" aria-pressed={x.key === target} onClick={() => setTarget(x.key)}
              className={cx('h-[34px] cursor-pointer rounded-full border px-3 text-[12.5px]', x.key === target ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink hover:bg-ground')}>{x.label}</button>)}
          </div>
          {current?.kind === 'local' && !isPassthrough(current) ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3">
              <Field label="内容（实时预览）" hint="每行一条，如 DOMAIN-SUFFIX,example.com；也可以是纯域名或纯 CIDR">{(id) => (
                <Textarea id={id} rows={16} spellCheck={false} className="min-h-[320px] font-mono text-[12.5px]" value={current.content ?? ''} onChange={(x) => setSource(current.id, { content: x.target.value })} />
              )}</Field>
              <div className="flex min-w-0 flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">{t.label} 输出</span><PreviewBody preview={preview} /></div>
            </div>
          ) : current && isPassthrough(current) ? (
            <p className="m-0 text-[13px] text-muted">mrs / srs 二进制规则集只做透传，不解析，也不参与合并去重。</p>
          ) : (
            <>
              {!current && preview.data?.stats && <MergedStats stats={preview.data.stats} />}
              <PreviewBody preview={preview} />
              {!current && !!preview.data?.passthroughSources?.length && <span className="text-[12.5px] text-muted">另有 {preview.data.passthroughSources.map((p) => `「${p.name}」`).join('')}以 {preview.data.passthroughSources[0]!.format} 透传，单独输出。</span>}
            </>
          )}
        </div>
      </Card>
      <RenameDialog open={renaming} title="重命名规则集" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => set({ name })} />
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
          <Field label="名称" hint="可选，缺省显示地址或「本地规则」">{(id) => <Input id={id} value={src.name ?? ''} onChange={(x) => onChange({ name: x.target.value || undefined })} />}</Field>
          <Field label="格式">{(id) => <Select id={id} value={src.format} onChange={(x) => onChange({ format: x.target.value as RuleSetFormat })}>{FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>}</Field>
          {src.format === 'mrs' && <Field label="behavior" hint="mrs 无法解析，必须声明">{(id) => <Select id={id} value={src.behavior ?? ''} onChange={(x) => onChange({ behavior: (x.target.value || undefined) as 'domain' | 'ipcidr' | undefined })}><option value="">请选择</option><option value="domain">domain</option><option value="ipcidr">ipcidr</option></Select>}</Field>}
          {src.kind === 'remote' && <Field label="缓存（小时）" hint="带失败快照，过期后后台刷新">{(id) => <Input id={id} type="number" min={1} step={1} value={Math.round((src.fetch?.ttlSec ?? 86400) / 3600)} onChange={(x) => {
            const h = Number(x.target.value);
            const { ttlSec: _, ...rest } = src.fetch ?? {};
            onChange({ fetch: h > 0 && h !== 24 ? { ...rest, ttlSec: h * 3600 } : Object.keys(rest).length ? rest : undefined });
          }} />}</Field>}
          {src.kind === 'local' && !isPassthrough(src) && <span className="col-span-full text-[12px] text-muted">内容在下方「输出预览」里编辑，右侧实时显示输出。</span>}
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
      <span className="text-[12.5px] text-ink-2">启用来源共 {stats.total} 条，去重 {stats.duplicates} 条，输出 {stats.total - stats.duplicates} 条；按 domain → classical → ipcidr 分别输出，IP 类放在最后，避免过早触发 DNS 解析。</span>
    </div>
  );
}

function PreviewBody({ preview }: { preview: UseQueryResult<RulesetPreview> }) {
  if (preview.error) return <ErrorBox error={preview.error} />;
  const p = preview.data;
  if (!p) return <Empty>加载中…</Empty>;
  return (
    <>
      {p.error && <ErrorBox error={`拉取失败：${p.error}`} />}
      <pre className={cx('m-0 max-h-[420px] min-h-[120px] overflow-auto rounded-lg bg-nav p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7] transition-opacity', preview.isFetching && 'opacity-70')}>{p.lines.join('\n') || '（空）'}</pre>
      <span className="text-[12px] text-muted">{p.total ?? p.lines.length} 行{(p.total ?? 0) > p.lines.length ? `（显示前 ${p.lines.length} 行）` : ''} · 降级 {p.notes?.length ?? 0} · 丢弃 {p.dropped.length} · 无法解析 {p.rejected.length}</span>
      {[...(p.notes ?? []).map((n) => ['降级', n]), ...p.dropped.map((x) => ['丢弃', x.reason]), ...p.rejected.map((x) => ['不支持', `第 ${x.line} 行 ${x.text}：${x.reason}`])].slice(0, 50).map(([k, v], i) => (
        <div key={i} className="flex gap-2 text-[12.5px]"><Badge tone={k === '降级' ? 'accent' : k === '丢弃' ? 'err' : 'warn'}>{k}</Badge><span className="min-w-0 break-all">{v}</span></div>
      ))}
    </>
  );
}
