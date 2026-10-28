// 规则集：本地 / 远程，按客户端与平台预览最终输出（RS-01–03、CR-05）；规则包：两层组合，只配一个出口（RB-01–05）。

import { useQuery } from '@tanstack/react-query';
import { parseRuleLine, type Client, type Platform, type RuleBundle, type RuleSetFormat } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RulesetPreview } from '../api.ts';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, Switch, Textarea } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList, type RuleSetDoc } from '../hooks.ts';
import { ruleText } from './profile/TabRules.tsx';

const FORMATS: { value: RuleSetFormat; label: string }[] = [
  { value: 'auto', label: '自动识别' }, { value: 'classical', label: 'classical 文本' }, { value: 'domain-set', label: 'Surge DOMAIN-SET' },
  { value: 'ipcidr', label: '纯 CIDR' }, { value: 'yaml', label: 'mihomo YAML payload' }, { value: 'mrs', label: 'mrs（透传）' },
];

export function RulesetList() {
  return (
    <DocList kind="rulesets" title="规则集" intro="一组匹配条件（不含出口）。解析成统一的中间表示后按客户端输出；管理员名下的规则集可被所有人引用。"
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

  return (
    <DetailShell listPath="/rulesets" listLabel="规则集" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => e.submit((x) => (x.kind === 'remote' ? { ...x, content: undefined } : { ...x, url: undefined }))} saveError={e.save.error} onDelete={() => e.remove(d.name)} deleteError={e.del.error}>
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
              {TARGETS.map((x) => <Button key={x.key} size="sm" variant={x.key === target ? 'primary' : 'default'} aria-pressed={x.key === target} onClick={() => setTarget(x.key)}>{x.label}</Button>)}
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
    </DetailShell>
  );
}

// ---------- 规则包 ----------

export function BundleList() {
  return (
    <DocList kind="bundles" title="规则包" intro="多个规则集或单条规则打包成一项，只配一个出口；输出时按 domain → classical → ipcidr 拆分（最多两层）。"
      columns={[
        { header: '名称', cell: (b) => b.name },
        { header: '子项', cell: (b) => <span className="font-mono">{b.items.length}</span> },
        { header: 'IP 类 no-resolve', cell: (b) => (b.noResolve ? '是' : '否') },
      ]} />
  );
}

const EMPTY_B: RuleBundle = { id: '', name: '', items: [] };

function RuleLineInput({ onAdd }: { onAdd: (rule: ReturnType<typeof parseRuleLine>) => void }) {
  const [line, setLine] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [line]);
  const add = () => { try { onAdd(parseRuleLine(line.trim())); setLine(''); } catch (x) { setErr((x as Error).message); } };
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex gap-2"><Input aria-label="单条规则" className="font-mono" placeholder="DOMAIN-SUFFIX,example.com" value={line} onChange={(x) => setLine(x.target.value)} onKeyDown={(x) => { if (x.key === 'Enter') add(); }} /><Button onClick={add} disabled={!line.trim()}><Plus size={15} />添加规则</Button></div>
      {err && <span className="text-[12px] text-err">{err}</span>}
    </div>
  );
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
      onSave={() => e.submit()} saveError={e.save.error} onDelete={() => e.remove(d.name)} deleteError={e.del.error}>
      <Card title="基本信息">
        <div className="flex flex-wrap items-end gap-5">
          <Field label="名称" className="min-w-64 flex-1">{(id) => <Input id={id} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>
          <label className="flex h-[38px] items-center gap-2.5 text-[13px]"><Switch label="IP 类规则统一 no-resolve" checked={!!d.noResolve} onChange={(v) => set({ noResolve: v })} />IP 类规则统一加 no-resolve</label>
        </div>
      </Card>
      <Card title="子项" bodyClass="pb-3">
        {!d.items.length ? <Empty>还没有子项。</Empty> : (
          <ul className="-mx-4 m-0 list-none p-0">
            {d.items.map((it, i) => (
              <li key={i} className={`flex items-center gap-3 border-t border-line-2 px-4 py-2.5 ${it.enabled === false ? 'opacity-55' : ''}`}>
                <Badge>{it.kind === 'ruleset' ? '规则集' : '单条规则'}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{it.kind === 'ruleset' ? name(it.id) : ruleText(it.rule)}</span>
                <Switch label={`启用子项 ${i + 1}`} checked={it.enabled !== false} onChange={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} />
                <Button size="sm" variant="ghost" aria-label={`删除子项 ${i + 1}`} onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </li>
            ))}
          </ul>
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
