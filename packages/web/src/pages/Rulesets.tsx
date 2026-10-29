// 规则集：本地 / 远程，按客户端与平台预览最终输出（RS-01–03、CR-05）；规则包：两层组合，只配一个出口（RB-01–05）。

import { useQuery } from '@tanstack/react-query';
import type { Client, Platform, RuleBundle, RuleIR, RuleSetFormat } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type RulesetPreview } from '../api.ts';
import { ClientOverrides, clientOverridesError, newClientOverride, ruleInputError } from '../components/ClientOverrides.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, Switch, Textarea, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList, type RuleSetDoc } from '../hooks.ts';
import { ruleText } from './profile/TabRules.tsx';

const FORMATS: { value: RuleSetFormat; label: string }[] = [
  { value: 'auto', label: '自动识别' }, { value: 'classical', label: 'classical 文本' }, { value: 'domain-set', label: 'Surge DOMAIN-SET' },
  { value: 'ipcidr', label: '纯 CIDR' }, { value: 'yaml', label: 'mihomo YAML payload' }, { value: 'mrs', label: 'mrs（透传）' },
];

export function RulesetList() {
  return (
    <DocList kind="rulesets" title="规则集" empty="一组匹配条件，可以来自远程地址或手写，在配置订阅的规则里配上出口。" intro="一组匹配条件（不含出口）。解析成统一的中间表示后按客户端输出；管理员名下的规则集可被所有人引用。"
      columns={[
        { header: '名称', cell: (r) => r.name },
        { header: '来源', cell: (r) => <Badge>{r.kind === 'remote' ? '远程' : '本地'}</Badge> },
        { header: '格式', cell: (r) => <span className="font-mono text-[12.5px]">{r.format}</span> },
      ]} />
  );
}

const EMPTY_RS: RuleSetDoc = { id: '', name: '', kind: 'local', format: 'auto', content: '' };
const TARGETS: { key: string; client: Client; platform?: Platform; label: string }[] = [
  { key: 'mihomo', client: 'mihomo', label: 'mihomo' },
  { key: 'mihomo-android', client: 'mihomo', platform: 'android', label: 'mihomo Android' },
  { key: 'surge-macos', client: 'surge', platform: 'macos', label: 'Surge macOS' },
  { key: 'surge-ios', client: 'surge', platform: 'ios', label: 'Surge iOS' },
];

export function RulesetEdit() {
  const e = useDocEditor('rulesets', EMPTY_RS);
  const [target, setTarget] = useState('mihomo');
  const t = TARGETS.find((x) => x.key === target)!;
  const saved = !e.isNew && !e.dirty;
  const preview = useQuery({
    queryKey: ['ruleset-preview', e.id, target, e.doc.dataUpdatedAt],
    enabled: saved,
    queryFn: () => api<RulesetPreview>('POST', `/rulesets/${e.id}/preview`, { client: t.client, ...(t.platform ? { platform: t.platform } : {}) }),
  });
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const overridesError = rulesetOverridesError(d.overrides ?? []);

  return (
    <DetailShell listPath="/rulesets" listLabel="规则集" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => { if (!overridesError) e.submit((x) => (x.kind === 'remote' ? { ...x, content: undefined } : { ...x, url: undefined })); }} saveError={overridesError ?? e.save.error} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}>
      <div className="flex flex-wrap items-start gap-5">
        <Card title="来源" className="min-w-0 flex-[999_1_520px]">
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
              <Field label="名称">{(id) => <Input id={id} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>
              <Field label="格式">{(id) => <Select id={id} value={d.format} onChange={(x) => set({ format: x.target.value as RuleSetFormat })}>{FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>}</Field>
              {d.format === 'mrs' && <Field label="behavior" hint="mrs 无法解析，必须声明">{(id) => <Select id={id} value={d.behavior ?? 'domain'} onChange={(x) => set({ behavior: x.target.value as 'domain' | 'ipcidr' })}><option value="domain">domain</option><option value="ipcidr">ipcidr</option></Select>}</Field>}
            </div>
            <Segmented label="来源" value={d.kind} options={[{ value: 'local', label: '本地编辑' }, { value: 'remote', label: '远程地址' }]} onChange={(kind) => set({ kind })} />
            {d.kind === 'remote'
              ? <Field label="地址" hint="带缓存与失败快照，默认 24 小时刷新">{(id) => <Input id={id} className="font-mono" value={d.url ?? ''} onChange={(x) => set({ url: x.target.value })} />}</Field>
              : <Field label="内容" hint="每行一条，如 DOMAIN-SUFFIX,example.com；也可以是纯域名或纯 CIDR">{(id) => <Textarea id={id} rows={14} className="font-mono text-[12.5px]" value={d.content ?? ''} onChange={(x) => set({ content: x.target.value })} />}</Field>}
          </div>
        </Card>
        <Card title="输出预览" className="min-w-0 flex-[1_1_360px]">
          <div className="flex flex-col gap-3">
            <div role="group" aria-label="客户端与平台" className="flex flex-wrap gap-1.5">
              {TARGETS.map((x) => <button key={x.key} type="button" aria-pressed={x.key === target} onClick={() => setTarget(x.key)}
                className={cx('h-[34px] cursor-pointer rounded-full border px-3 text-[12.5px]', x.key === target ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink hover:bg-ground')}>{x.label}</button>)}
            </div>
            {!saved ? <Empty>保存后预览。</Empty> : preview.error ? <ErrorBox error={preview.error} /> : preview.data && (
              preview.data.passthrough ? <p className="m-0 text-[13px] text-muted">mrs / srs 二进制规则集只做透传，不解析。</p> : (
                <>
                  {preview.data.error && <ErrorBox error={`拉取失败：${preview.data.error}`} />}
                  <pre className="m-0 max-h-80 overflow-auto rounded-lg bg-nav p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7]">{preview.data.lines.join('\n') || '（空）'}</pre>
                  <span className="text-[12px] text-muted">{preview.data.lines.length} 行 · 降级 {preview.data.notes?.length ?? 0} · 丢弃 {preview.data.dropped.length} · 无法解析 {preview.data.rejected.length}</span>
                  {[...(preview.data.notes ?? []).map((n) => ['降级', n]), ...preview.data.dropped.map((x) => ['丢弃', x.reason]), ...preview.data.rejected.map((x) => ['不支持', `第 ${x.line} 行 ${x.text}：${x.reason}`])].map(([k, v], i) => (
                    <div key={i} className="flex gap-2 text-[12.5px]"><Badge tone={k === '降级' ? 'accent' : k === '丢弃' ? 'err' : 'warn'}>{k}</Badge><span className="min-w-0 break-all">{v}</span></div>
                  ))}
                </>
              )
            )}
          </div>
        </Card>
      </div>
      <RulesetOverrides value={d.overrides ?? []} onChange={(overrides) => set({ overrides })} />
    </DetailShell>
  );
}

type LineOverride = NonNullable<RuleSetDoc['overrides']>[number];

function rulesetOverridesError(value: LineOverride[]): string | undefined {
  for (const [i, item] of value.entries()) {
    if (item.line !== undefined ? !Number.isSafeInteger(item.line) || item.line < 1 : !item.match?.trim()) {
      return `行级覆盖第 ${i + 1} 条：请填写从 1 开始的整数行号或原文。`;
    }
    const error = clientOverridesError([item.override]);
    if (error) return `行级覆盖第 ${i + 1} 条：${error}`;
  }
  return undefined;
}

function RulesetOverrides({ value, onChange }: { value: LineOverride[]; onChange: (value: LineOverride[]) => void }) {
  const update = (index: number, item: LineOverride) => onChange(value.map((entry, i) => i === index ? item : entry));
  return <Card title="行级客户端覆盖" actions={<Button onClick={() => onChange([...value, { line: 1, override: newClientOverride() }])}><Plus size={15} />添加行级覆盖</Button>}>
    <p className="mt-0 text-[12.5px] text-muted">按解析后的行号（从 1 开始）或原文精确匹配定位。同一行命中第一条客户端与平台匹配的覆盖，可拖拽调整优先级；mrs / srs 透传格式不应用行级覆盖。</p>
    {!value.length ? <Empty>没有行级覆盖。</Empty> : <SortableList items={value} onReorder={onChange} renderItem={(item, i, handle) => {
      const mode = item.match !== undefined && item.line === undefined ? 'match' : 'line';
      return <div className="my-3 flex items-start gap-2 rounded-lg border border-line p-3">
        {handle}<div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label={`第 ${i + 1} 条定位方式`} value={mode} options={[{ value: 'line', label: '按行号' }, { value: 'match', label: '按原文精确匹配' }]} onChange={(next) => {
              if (next === mode) return;
              const { line: _, match: __, ...rest } = item;
              update(i, next === 'line' ? { ...rest, line: 1 } : { ...rest, match: '' });
            }} />
            <Button size="sm" variant="ghost" aria-label={`删除行级覆盖 ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
          </div>
          {mode === 'line' ? <Field label="行号" hint="从 1 开始，以解析结果中的行号为准">{(id) => <Input id={id} type="number" min={1} step={1} value={item.line ?? ''} onChange={(e) => {
            const { match: _, ...rest } = item;
            update(i, { ...rest, line: e.target.value === '' ? undefined : Number(e.target.value) });
          }} />}</Field> : <Field label="原文精确匹配" hint="保持规则原文，不含出口">{(id) => <Input id={id} className="font-mono" value={item.match ?? ''} onChange={(e) => {
            const { line: _, ...rest } = item;
            update(i, { ...rest, match: e.target.value });
          }} />}</Field>}
          <ClientOverrides single value={[item.override]} onChange={(overrides) => update(i, { ...item, override: overrides[0]! })} />
        </div>
      </div>;
    }} />}
    <ErrorBox error={rulesetOverridesError(value)} />
  </Card>;
}

// ---------- 规则包 ----------

export function BundleList() {
  return (
    <DocList kind="bundles" title="规则包" empty="把多个规则集或单条规则打包，在规则列表里只占一行、只配一个出口。" intro="多个规则集或单条规则打包成一项，只配一个出口；输出时按 domain → classical → ipcidr 拆分（最多两层）。"
      columns={[
        { header: '名称', cell: (b) => b.name },
        { header: '子项', cell: (b) => <span className="font-mono">{b.items.length} 项 · 启用中 {b.items.filter((item) => item.enabled !== false).length} 项</span> },
        { header: 'IP 类 no-resolve', cell: (b) => (b.noResolve ? '是' : '否') },
      ]} />
  );
}

const EMPTY_B: RuleBundle = { id: '', name: '', items: [] };

function RuleLineInput({ onAdd }: { onAdd: (rule: RuleIR) => void }) {
  const [rule, setRule] = useState<RuleIR>();
  const [revision, setRevision] = useState(0);
  const error = ruleInputError(rule);
  return <div className="flex min-w-64 flex-1 flex-col gap-3">
    <RuleEditor key={revision} value={rule} onChange={setRule} onIncomplete={setRule} />
    {rule && <ErrorBox error={error} />}
    <Button className="self-start" disabled={!!error} onClick={() => {
      if (!rule || error) return;
      onAdd(rule); setRule(undefined); setRevision((value) => value + 1);
    }}><Plus size={15} />添加规则</Button>
  </div>;
}

export function BundleEdit() {
  const e = useDocEditor('bundles', EMPTY_B);
  const rulesets = useList('rulesets').data ?? [];
  const [rs, setRs] = useState('');
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleBundle>) => e.setDraft({ ...d, ...p });
  const name = (id: string) => rulesets.find((r) => r.id === id)?.name ?? id;

  return (
    <DetailShell listPath="/bundles" listLabel="规则包" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => e.submit()} saveError={e.save.error} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}>
      <Card title="基本信息">
        <div className="flex flex-wrap items-end gap-5">
          <Field label="名称" className="min-w-64 flex-1">{(id) => <Input id={id} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>
          <label className="flex h-[38px] items-center gap-2.5 text-[13px]"><Switch label="IP 类规则统一 no-resolve" checked={!!d.noResolve} onChange={(v) => set({ noResolve: v })} />IP 类规则统一加 no-resolve</label>
        </div>
      </Card>
      <Card title={`子项 ${d.items.length} 项 · 启用中 ${d.items.filter((item) => item.enabled !== false).length} 项`} bodyClass="px-4 pb-3">
        {!d.items.length ? <Empty>还没有子项。</Empty> : (
          <SortableList items={d.items} onReorder={(items) => set({ items })} renderItem={(it, i, handle) => (
              <div className={`flex items-center gap-3 border-t border-line-2 py-2.5 ${it.enabled === false ? 'opacity-55' : ''}`}>
                {handle}<Badge>{it.kind === 'ruleset' ? '规则集' : '单条规则'}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{it.kind === 'ruleset' ? name(it.id) : ruleText(it.rule)}</span>
                <Switch label={`启用子项 ${i + 1}`} checked={it.enabled !== false} onChange={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} />
                <Button size="sm" variant="ghost" aria-label={`删除子项 ${i + 1}`} onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
            )} />
        )}
        <div className="-mx-4 mt-1 flex flex-wrap gap-3 border-t border-line-2 px-4 pt-3">
          <div className="flex gap-2">
            <Select aria-label="规则集" className="w-56" value={rs} onChange={(x) => setRs(x.target.value)}>
              <option value="">选择规则集</option>
              {rulesets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Button disabled={!rs} onClick={() => { set({ items: [...d.items, { kind: 'ruleset', id: rs }] }); setRs(''); }}><Plus size={15} />添加规则集</Button>
          </div>
          <RuleLineInput onAdd={(rule) => set({ items: [...d.items, { kind: 'rule', rule }] })} />
        </div>
      </Card>
    </DetailShell>
  );
}
