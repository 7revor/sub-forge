// 规则集：本地 / 远程，按客户端与平台预览最终输出（RS-01–03、CR-05）；规则包：两层组合，只配一个出口（RB-01–05）。

import { useQuery } from '@tanstack/react-query';
import { behaviorOf, parseRuleSetContent, ruleKey, type Client, type Platform, type RuleBundle, type RuleIR, type RuleSetFormat } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type RulesetPreview } from '../api.ts';
import { ClientOverrides, clientOverridesError, newClientOverride, ruleInputError } from '../components/ClientOverrides.tsx';
import { RuleEditor } from '../components/RuleEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorBox, Field, Input, Modal, Segmented, Select, Switch, Textarea, cx, td, th } from '../components/ui.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
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

function SourceFields({ d, set, autoFocusName }: { d: RuleSetDoc; set: (p: Partial<RuleSetDoc>) => void; autoFocusName?: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <Field label="名称">{(id) => <Input id={id} autoFocus={autoFocusName} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>
        <Field label="格式">{(id) => <Select id={id} value={d.format} onChange={(x) => set({ format: x.target.value as RuleSetFormat })}>{FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>}</Field>
        {d.format === 'mrs' && <Field label="behavior" hint="mrs 无法解析，必须声明">{(id) => <Select id={id} value={d.behavior ?? 'domain'} onChange={(x) => set({ behavior: x.target.value as 'domain' | 'ipcidr' })}><option value="domain">domain</option><option value="ipcidr">ipcidr</option></Select>}</Field>}
      </div>
      <Segmented label="来源" value={d.kind} options={[{ value: 'local', label: '本地编辑' }, { value: 'remote', label: '远程地址' }]} onChange={(kind) => set({ kind })} />
      {d.kind === 'remote'
        ? <Field label="地址" hint="带缓存与失败快照，默认 24 小时刷新">{(id) => <Input id={id} className="font-mono" placeholder="https://" value={d.url ?? ''} onChange={(x) => set({ url: x.target.value })} />}</Field>
        : <Field label="内容" hint="每行一条，如 DOMAIN-SUFFIX,example.com；也可以是纯域名或纯 CIDR">{(id) => <Textarea id={id} rows={14} className="font-mono text-[12.5px]" value={d.content ?? ''} onChange={(x) => set({ content: x.target.value })} />}</Field>}
    </div>
  );
}

const FORMAT_TEXT: Record<string, string> = { auto: '自动识别', classical: 'classical', 'domain-set': 'DOMAIN-SET', domain: 'DOMAIN-SET', ipcidr: 'CIDR', yaml: 'YAML payload', mrs: 'mrs', srs: 'srs' };

/** 规则集（设计稿「规则集」）：自上而下为客户端改写、解析结果（仅本地文本规则集）、输出预览，每块独占一行；来源在「编辑来源」对话框里改 */
export function RulesetEdit() {
  const e = useDocEditor('rulesets', EMPTY_RS);
  const [target, setTarget] = useState('mihomo');
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [q, setQ] = useState('');
  const t = TARGETS.find((x) => x.key === target)!;
  const saved = !e.isNew && !e.dirty;
  const preview = useQuery({
    queryKey: ['ruleset-preview', e.id, target, e.doc.dataUpdatedAt],
    enabled: saved,
    queryFn: () => api<RulesetPreview>('POST', `/rulesets/${e.id}/preview`, { client: t.client, ...(t.platform ? { platform: t.platform } : {}) }),
  });
  const parsed = useMemo(() => (e.draft?.kind === 'local' ? parseRuleSetContent(e.draft.content ?? '', e.draft.format, e.draft.behavior) : undefined), [e.draft?.kind, e.draft?.content, e.draft?.format, e.draft?.behavior]);
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleSetDoc>) => e.setDraft({ ...d, ...p });
  const overridesError = rulesetOverridesError(d.overrides ?? []);
  const rows = parsed && !parsed.passthrough
    ? [...parsed.rules.map((r) => ({ line: r.line, text: r.text, ir: ruleText(r.rule), reason: undefined as string | undefined })), ...parsed.rejected.map((r) => ({ line: r.line, text: r.text, ir: '—', reason: r.reason }))].sort((x, y) => x.line - y.line)
    : [];
  const shown = rows.filter((r) => !q.trim() || r.text.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <DetailShell listPath="/rulesets" listLabel="规则集" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => { if (!overridesError) e.submit((x) => (x.kind === 'remote' ? { ...x, content: undefined } : { ...x, url: undefined })); }} saveError={overridesError ?? e.save.error}
      onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      moreItems={[{ label: '重命名…', onSelect: () => setRenaming(true) }]}
      extraActions={!e.isNew && <Button onClick={() => setEditing(true)}>编辑来源</Button>}
      badges={!e.isNew && <>
        <Badge>{d.kind === 'remote' ? '远程' : '本地'} · {FORMAT_TEXT[parsed && !parsed.passthrough ? parsed.format : d.format] ?? d.format}</Badge>
        {d.kind === 'remote' && <Badge>缓存 {Math.round((d.fetch?.ttlSec ?? 86400) / 3600)} 小时</Badge>}
        {d.kind === 'remote' && preview.data && <Badge tone={preview.data.error ? 'err' : 'ok'}>{preview.data.error ? '拉取失败' : '拉取成功'}</Badge>}
        {parsed && !parsed.passthrough && <Badge tone={parsed.rejected.length ? 'warn' : 'neutral'}>解析 {parsed.rules.length} 行{parsed.rejected.length ? ` · 不支持 ${parsed.rejected.length} 行` : ''}</Badge>}
      </>}>
      {e.isNew ? <Card title="来源"><SourceFields d={d} set={set} autoFocusName /></Card> : (
        <>
          <RulesetOverrides value={d.overrides ?? []} onChange={(overrides) => set({ overrides })} />
          {d.kind === 'local' && !parsed?.passthrough && <Card className="min-w-0" bodyClass="overflow-x-auto"
            title={<h2 className="m-0 text-[15px] font-semibold">解析结果</h2>}
            actions={<Input aria-label="搜索规则" placeholder="搜索" className="h-9 w-[200px]" value={q} onChange={(x) => setQ(x.target.value)} />}>
            <table className="w-full min-w-[560px] border-collapse">
              <thead><tr><th className={cx(th, 'w-12')}>#</th><th className={th}>原始行</th><th className={th}>中间表示</th><th className={th}>状态</th></tr></thead>
              <tbody>
                {shown.slice(0, 300).map((r) => (
                  <tr key={r.line}>
                    <td className={cx(td, 'font-mono text-[12px] text-muted')}>{r.line}</td>
                    <td className={cx(td, 'font-mono text-[12.5px] break-all')}>{r.text}</td>
                    <td className={cx(td, 'font-mono text-[12px] text-ink-2 break-all')}>{r.ir}</td>
                    <td className={td}>{r.reason ? <Badge tone="warn">{r.reason}</Badge> : <Badge tone="ok">正常</Badge>}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={4} className={cx(td, 'text-muted')}>{rows.length ? `没有包含「${q.trim()}」的行` : '内容为空。点击「编辑来源」填写规则。'}</td></tr>}
              </tbody>
            </table>
            {shown.length > 300 && <div className="px-4 py-2.5 text-[12.5px] text-muted">显示前 300 行，共 {shown.length} 行</div>}
          </Card>}
          <Card title="输出预览" className="min-w-0">
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
        </>
      )}
      <Modal title="编辑来源" open={editing} onClose={() => setEditing(false)} wide footer={<Button variant="primary" onClick={() => setEditing(false)}>完成</Button>}>
        <SourceFields d={d} set={set} />
        <span className="text-[12px] text-muted">改动在页面右上角「保存」后生效。</span>
      </Modal>
      <RenameDialog open={renaming} title="重命名规则集" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => set({ name })} />
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
  return <Card title="客户端改写" actions={<Button onClick={() => onChange([...value, { line: 1, override: newClientOverride() }])}><Plus size={15} />添加改写</Button>}>
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
  return <div className="flex flex-col gap-3">
    <RuleEditor key={revision} value={rule} onChange={setRule} onIncomplete={setRule} />
    {rule && <ErrorBox error={error} />}
    <Button variant="primary" className="self-end" disabled={!rule || !!error} onClick={() => {
      if (!rule || error) return;
      onAdd(rule); setRule(undefined); setRevision((value) => value + 1);
    }}>添加规则</Button>
  </div>;
}

type Behavior = 'domain' | 'classical' | 'ipcidr';
/** 子项的 behavior 与条数：本地规则集在浏览器里解析，远程规则集要等服务端拉取，显示为未知 */
function itemStats(item: RuleBundle['items'][number], rulesets: RuleSetDoc[]): { behavior?: Behavior | '混合'; keys?: { key: string; behavior: Behavior }[]; src: string; name: string } {
  if (item.kind === 'rule') return { name: ruleText(item.rule), src: '单条规则', behavior: behaviorOf(item.rule), keys: [{ key: ruleKey(item.rule), behavior: behaviorOf(item.rule) }] };
  const rs = rulesets.find((r) => r.id === item.id);
  if (!rs) return { name: item.id, src: '规则集不存在' };
  if (rs.kind === 'remote') return { name: rs.name, src: `远程 · ${rs.format}`, ...(rs.behavior ? { behavior: rs.behavior } : {}) };
  const parsed = parseRuleSetContent(rs.content ?? '', rs.format, rs.behavior);
  if (parsed.passthrough) return { name: rs.name, src: `本地 · ${rs.format}`, ...(rs.behavior ? { behavior: rs.behavior } : {}) };
  const keys = parsed.rules.map((r) => ({ key: ruleKey(r.rule), behavior: behaviorOf(r.rule) }));
  const kinds = new Set(keys.map((k) => k.behavior));
  return { name: rs.name, src: `本地规则集 · ${parsed.format}`, keys, behavior: kinds.size === 1 ? [...kinds][0] : kinds.size ? '混合' : undefined };
}

/** 规则包（设计稿「规则包」）：子项列表 + 合并结果 + 同一出口下的输出顺序 */
export function BundleEdit() {
  const e = useDocEditor('bundles', EMPTY_B);
  const rulesets = useList('rulesets').data ?? [];
  const bundles = useList('bundles').data ?? [];
  const [pickRs, setPickRs] = useState(false);
  const [addRule, setAddRule] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [rs, setRs] = useState('');
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<RuleBundle>) => e.setDraft({ ...d, ...p });
  const stats = d.items.map((it) => itemStats(it, rulesets));
  const enabled = stats.filter((_, i) => d.items[i]!.enabled !== false);
  const known = enabled.flatMap((s) => s.keys ?? []);
  const unique = new Map(known.map((k) => [k.key, k.behavior]));
  const merged = (['domain', 'classical', 'ipcidr'] as Behavior[]).map((b) => [b, [...unique.values()].filter((x) => x === b).length] as const);
  const unknownCount = enabled.filter((s) => !s.keys).length;
  const slug = d.id || 'new';
  const present = merged.filter(([, n]) => n > 0).map(([b]) => b);

  return (
    <DetailShell listPath="/bundles" listLabel="规则包" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => e.submit()} saveError={e.save.error} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      moreItems={[{ label: '重命名…', onSelect: () => setRenaming(true) }]}
      extraActions={!e.isNew && <Link to={`/rule-repo?bundle=${encodeURIComponent(d.id)}`} className={buttonClass()}>从规则仓库添加</Link>}>
      <p className="m-0 -mt-2 text-[13px] text-muted">一个规则包在规则列表中只占一行、只配一个出口。包内最多两层：不能再放规则包。</p>
      {e.isNew && <Card title="名称"><Field label="名称">{(id) => <Input id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field></Card>}
      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[999_1_560px]" bodyClass="pb-1" title={<h2 className="m-0 text-[15px] font-semibold">子项</h2>}
          actions={<><Button className="h-9" onClick={() => setPickRs(true)}>添加规则集</Button><Button className="h-9" onClick={() => setAddRule(true)}>添加单条规则</Button></>}>
          {!d.items.length ? <div className="px-4 pb-4 text-[13px] text-muted">还没有子项。添加规则集或单条规则。</div> : (
            <SortableList items={d.items} onReorder={(items) => set({ items })} renderItem={(it, i, handle) => {
              const st = stats[i]!;
              const on = it.enabled !== false;
              return (
                <div className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line-2 py-3 pr-4 pl-2', !on && 'opacity-55')}>
                  {handle}
                  <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5"><span className={cx('truncate text-[13.5px] font-medium', it.kind === 'rule' && 'font-mono')}>{st.name}</span><span className="text-[12px] text-muted">{st.src}</span></span>
                  <span className="rounded bg-[#ebedf1] px-2 py-0.5 font-mono text-[12px] text-ink-2">{st.behavior ?? '未知'}</span>
                  <span className="w-16 text-right font-mono text-[12.5px]">{st.keys ? st.keys.length : '—'}</span>
                  <Switch label={`启用 ${st.name}`} checked={on} onChange={(v) => set({ items: d.items.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} />
                  <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`删除 ${st.name}`} onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
              );
            }} />
          )}
          {bundles.some((b) => b.id !== d.id) && <div className="mx-4 mt-1 mb-3 rounded-lg bg-ground px-3 py-2.5 text-[12.5px] text-muted">规则包不能放进规则包（最多两层），所以添加规则集时不会列出其他规则包。</div>}
        </Card>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
          <section className="flex flex-col gap-3 rounded-[10px] border border-line bg-panel px-4 py-3.5">
            <h2 className="m-0 text-[15px] font-semibold">合并结果</h2>
            <div className="grid grid-cols-3 gap-2">
              {merged.map(([t, n]) => <div key={t} className="flex flex-col gap-0.5 rounded-lg bg-ground p-2.5"><span className="font-mono text-[11.5px] text-muted">{t}</span><span className="text-xl font-semibold">{n}</span></div>)}
            </div>
            <span className="text-[12.5px] text-ink-2">启用 {known.length} 条，去重 {known.length - unique.size} 条，输出 {unique.size} 条{unknownCount ? `；另有 ${unknownCount} 个远程或二进制规则集在下发时合并` : ''}</span>
            <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="h-[18px] w-[18px] accent-accent" checked={!!d.noResolve} onChange={(x) => set({ noResolve: x.target.checked })} />IP 类规则统一加 <span className="font-mono">no-resolve</span></label>
          </section>
          <section className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel px-4 py-3.5">
            <h2 className="m-0 text-[14px] font-semibold">输出顺序（同一出口）</h2>
            <pre className="m-0 overflow-x-auto rounded-lg bg-nav p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7]">{(present.length ? present : ['domain', 'classical', 'ipcidr']).map((b) => `RULE-SET,b_${slug}_${b},[出口]${b === 'ipcidr' && d.noResolve ? ',no-resolve' : ''}`).join('\n')}</pre>
            <span className="text-[12px] leading-normal text-muted">domain 类在前、IP 类在后，避免过早触发 DNS 解析。</span>
          </section>
        </div>
      </div>
      <Modal title="添加规则集" open={pickRs} onClose={() => setPickRs(false)}
        footer={<><Button onClick={() => setPickRs(false)}>取消</Button><Button variant="primary" disabled={!rs} onClick={() => { set({ items: [...d.items, { kind: 'ruleset', id: rs }] }); setRs(''); setPickRs(false); }}>添加</Button></>}>
        <Field label="规则集">{(id) => <Select id={id} value={rs} onChange={(x) => setRs(x.target.value)}>
          <option value="">选择规则集</option>
          {rulesets.map((r) => <option key={r.id} value={r.id} disabled={d.items.some((it) => it.kind === 'ruleset' && it.id === r.id)}>{r.name}（{r.kind === 'remote' ? '远程' : '本地'}）</option>)}
        </Select>}</Field>
        <span className="text-[12px] text-muted">也可以从<Link to={`/rule-repo?bundle=${encodeURIComponent(d.id)}`} className="text-accent">规则仓库</Link>直接引用。</span>
      </Modal>
      <Modal title="添加单条规则" open={addRule} onClose={() => setAddRule(false)} wide>
        <RuleLineInput onAdd={(rule) => { set({ items: [...d.items, { kind: 'rule', rule }] }); setAddRule(false); }} />
      </Modal>
      <RenameDialog open={renaming} title="重命名规则包" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => set({ name })} />
    </DetailShell>
  );
}
