import { alertError, notifySuccess } from '../feedback.ts';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { RuleSetPicker } from '../components/RuleSetPicker.tsx';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { RulesetPreview } from '../components/RulesetPreview.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { RejectedRulesPopover } from '../components/RejectedRulesPopover.tsx';
// 规则集（RS-01–04、CR-05）：一个规则集由多个来源（远程地址 / 本地规则）合并而成，只配一个出口。
// 选中来源时预览该来源，取消选中时预览合并结果；本地内容仍在来源配置中编辑。

import { FileText, Globe, Link2, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { RulesetSourceStatus } from '../api.ts';
import { RulesetOverrides, overridesError } from '../components/RulesetOverrides.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, Card, Empty, ErrorAlert, FieldError, Field, Input, Textarea, buttonClass, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import type { RuleSetDoc, RuleSetSourceDoc } from '../hooks.ts';
import { newId } from '../convert/templateYaml.ts';

const FORMAT_TEXT: Record<string, string> = { auto: '待识别', classical: 'Classical', 'domain-set': 'Domain-set', domain: 'Domain', ipcidr: 'CIDR', yaml: 'YAML', mrs: 'MRS', srs: 'SRS' };
const isPassthrough = (s: RuleSetSourceDoc) => s.format === 'mrs' || s.format === 'srs';
const sourceLabel = (s: RuleSetSourceDoc) => s.name?.trim() || (s.kind === 'remote' ? s.url || '远程地址' : '本地规则');

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
const sourceActionClass = buttonClass('default', 'md', 'w-full min-w-0 whitespace-normal max-sm:gap-1.5 max-sm:px-2 max-sm:text-[12px]');

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
  const [selected, setSelected] = useState<string | undefined>();
  useEffect(() => {
    if (!selected) return;
    const dismiss = (event: PointerEvent) => {
      const card = event.target instanceof Element ? event.target.closest('[data-ruleset-source]') : null;
      if (card?.getAttribute('data-ruleset-source') !== selected) setSelected(undefined);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [selected]);
  const sources = useRulesetSources(e.isNew ? undefined : e.id, e.draft, selected);
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const d = e.draft;
  const selectedSource = d.sources.find((s) => s.id === selected);
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const setSource = (id: string, p: Partial<RuleSetSourceDoc>) => set({ sources: d.sources.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const add = (src: RuleSetSourceDoc) => { set({ sources: [...d.sources, src] }); setSelected(src.id); };
  const status = sources.statuses;
  const failing = d.sources.filter((s) => s.kind === 'remote' && status.get(s.id)?.error).length;
  const error = rulesetError(d);

  return (
    <DetailShell listPath="/rulesets" listLabel="增强集合" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => {
        if (error) { alertError(error); return; }
        if (!error) e.submit((x) => ({ ...x, sources: x.sources.map(({ url, content, fetch, ...s }) => (s.kind === 'remote' ? { ...s, url, ...(fetch ? { fetch } : {}) } : { ...s, content: content ?? '' })) }));
      }}
      saveError={e.save.error}
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
      <Card title="来源">
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="添加规则来源" className="grid grid-cols-3 gap-2">
            <RepositoryPicker key={d.id} onAdd={sources => {
              e.setDraft(current => {
                if (!current || current.id !== d.id) return current;
                const added = sources.filter(s => !current.sources.some(existing => existing.url === s.url));
                return { ...current, sources: [...current.sources, ...added] };
              });
              setSelected(d.sources.find(s => s.url === sources[0]?.url)?.id ?? sources[0]?.id);
            }} />
            <button type="button" className={sourceActionClass} onClick={() => add(newRemote())}><Globe size={15} className="hidden shrink-0 sm:block" />添加远程地址</button>
            <button type="button" className={sourceActionClass} onClick={() => add(newLocal())}><FileText size={15} className="hidden shrink-0 sm:block" />添加本地规则</button>
          </div>
          {!!d.sources.length && (
            <SortableList items={d.sources} getKey={(s) => s.id} onReorder={(sources) => set({ sources })} renderItem={(s, _i, handle) => (
              <SourceRow src={s} handle={handle} active={s.id === selected} status={status.get(s.id)} loading={sources.loading.has(s.id)}
                onSelect={() => setSelected(s.id === selected ? undefined : s.id)}
                onChange={(p) => setSource(s.id, p)}
                onDelete={() => { set({ sources: d.sources.filter((x) => x.id !== s.id) }); if (s.id === selected) setSelected(undefined); }} />
            )} />
          )}
        </div>
      </Card>

      <RulesetOverrides value={d.overrides ?? []} legacySources={d.sources}
        onChange={(overrides) => set({ overrides: overrides.length ? overrides : undefined })}
        onRemoveLegacy={(id) => setSource(id, { overrides: undefined })} />

      <Card className="min-w-0" title={selectedSource ? `来源预览 · ${sourceLabel(selectedSource)}` : '合并结果（只读）'}
        actions={selectedSource && <Button onClick={() => setSelected(undefined)}>查看合并结果</Button>}>
        <RulesetPreview key={e.id} inputs={sources.inputs} ready={sources.ready} sourceId={selected} sourceReading={sources.reading} onRefreshSources={sources.refresh}
          overrides={d.overrides} sourceError={sources.error} sourceNames={Object.fromEntries(d.sources.map(s => [s.id, sourceLabel(s)]))} />
      </Card>
    </DetailShell>
  );
}

function RepositoryPicker({ onAdd }: { onAdd: (sources: RuleSetSourceDoc[]) => void }) {
  return <RuleSetPicker scope="repository" label="关联规则集合" triggerClassName={sourceActionClass}
    triggerIcon={<Link2 size={15} className="hidden shrink-0 sm:block" />} onSelect={matcher => {
      if (!matcher.repository) return;
      onAdd(matcher.repository.sources.map(source => ({ ...source, id: newId('src') })));
      notifySuccess('规则集合已关联，保存后生效');
    }} />;
}

function SourceRow({ src, handle, active, status, loading, onSelect, onChange, onDelete }: {
  src: RuleSetSourceDoc; handle: ReactNode; active: boolean; status?: RulesetSourceStatus; loading: boolean;
  onSelect: () => void; onChange: (p: Partial<RuleSetSourceDoc>) => void; onDelete: () => void;
}) {
  const label = sourceLabel(src);
  const editingUrl = active && src.kind === 'remote' && !src.repository;
  const title = editingUrl ? src.name?.trim() || '远程地址' : label;
  const lines = src.kind === 'local' ? (src.content ?? '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length : undefined;
  const detected = status?.format ? FORMAT_TEXT[status.format] ?? status.format : '自动识别';
  const sub = src.kind === 'remote'
    ? [!editingUrl && src.name?.trim() && src.url, `${src.repository ? '仓库关联' : '自定义远程'} · ${detected}`].filter(Boolean).join(' · ')
    : `本地 · ${detected} · ${lines} 行`;
  return (
    <div data-ruleset-source={src.id} className={cx('my-2 rounded-lg border', active ? 'border-brand bg-[#f8faff]' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-3 pl-2">
        {handle}
        <button type="button" aria-pressed={active} onClick={onSelect} className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left">
          <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-md', src.kind === 'remote' ? 'bg-accent-soft text-accent-ink' : 'bg-[#ebedf1] text-ink-2')} aria-hidden="true">
            {src.repository ? <Link2 size={15} /> : src.kind === 'remote' ? <Globe size={15} /> : <FileText size={15} />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span title={title} className={cx('truncate text-[13.5px] font-medium', src.kind === 'remote' && !src.name?.trim() && !editingUrl && 'font-mono text-[12.5px]')}>{title}</span>
            {!src.repository && <span title={sub} className="truncate text-[12px] text-ink-muted">{sub}</span>}
          </span>
        </button>
        {src.kind === 'remote' && src.repository && src.url && <CopyButton text={src.url} size="sm" variant="ghost" aria-label={`复制关联地址 ${label}`}>复制地址</CopyButton>}
        <SourceStatus src={src} status={status} loading={loading} />
        <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`删除 ${label}`} onClick={onDelete}><Trash2 size={14} /></Button>
      </div>
      {active && (editingUrl || (src.kind === 'local' && !isPassthrough(src))) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 border-t border-line-2 px-4 pt-3 pb-3.5">
          {src.kind === 'remote' && !src.repository && <Field label="地址" className="col-span-full">{(id) => <Input id={id} autoFocus={!src.url} className="font-mono" placeholder="https://" value={src.url ?? ''} onChange={(x) => onChange({ url: x.target.value })} />}</Field>}
          {src.kind === 'local' && !isPassthrough(src) && <Field className="col-span-full" label="本地规则内容" hint="自动识别 classical 规则、域名、CIDR 或 YAML payload。">{(id) => (
            <LocalContentInput format={status?.format} id={id} rows={10} spellCheck={false} className="min-h-[220px] font-mono text-[12.5px]" value={src.content ?? ''} onChange={(x) => onChange({ content: x.target.value })} />
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
  if (status.rejected) return <RejectedRulesPopover sourceName={sourceLabel(src)} status={status} />;
  return <Badge>{status.rules} 条</Badge>;
}

function LocalContentInput({ format, ...props }: React.ComponentProps<typeof YamlTextarea> & { format?: string }) {
  return format === 'yaml' ? <YamlTextarea {...props} /> : <Textarea {...props} />;
}
