import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
// 关联摘要与变更操作分开；转换只影响当前草稿，保存订阅后生效。
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { Badge, Button, ErrorAlert, Field, Select, cx } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { boundTemplateId, persistedProfile } from './routing.ts';

type Conversion = { item: ProfileDoc; changes: string[] };

function AssociationEditor({ onDone }: { onDone?: () => void }) {
  const { draft, setDraft, template, groups } = useProfile();
  const templates = useTemplates();
  const currentId = boundTemplateId(draft);
  const [selected, setSelected] = useState(currentId ?? '');
  const [mode, setMode] = useState<'bound' | 'copy'>('bound');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<Conversion>();
  const target = templates.data?.find(t => t.id === selected);
  const apply = (item: ProfileDoc) => { setDraft(item); setStaged(undefined); onDone?.(); };
  const change = useMutation({
    mutationFn: async (action: 'bound' | 'copy' | 'detach') => {
      // 转换接口复用完整文档校验；临时名称仅用于检查，不写入订阅草稿。
      const profile = persistedProfile({ ...draft, name: draft.name.trim() || '未命名订阅' });
      if (action === 'detach') return api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'independent' });
      if (!target) throw new Error('请先选择模板');
      const effectiveMapping = Object.fromEntries(groups.flatMap(g => {
        const value = mapping[g.id] ?? (selected === currentId && target.groups.some(t => t.id === g.id) ? g.id : '');
        return value ? [[g.id, value === '__drop' ? null : value]] : [];
      }));
      const bound = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'bound', templateId: target.id, mapping: effectiveMapping });
      if (action === 'bound') return bound;
      const independent = await api<Conversion>('POST', '/profiles/routing/convert', { profile: bound.item, mode: 'independent' });
      return { ...independent, changes: [...bound.changes, ...independent.changes] };
    },
    onSuccess: converted => {
      const result = { ...converted, item: { ...converted.item, name: draft.name } };
      if (!groups.length && !draft.chains.length && draft.routing?.mode === 'independent' && !draft.routing.config.rules.length) apply(result.item);
      else setStaged(result);
    },
  });
  const reset = () => { setStaged(undefined); change.reset(); };
  return <div className="flex flex-col gap-4">
    <ErrorAlert error={templates.error ?? change.error} />
    <Field label="模板">{id => <Select id={id} value={selected} disabled={change.isPending} onChange={e => { setSelected(e.target.value); setMapping({}); reset(); }}>
      <option value="">{templates.isLoading ? '正在加载模板…' : '选择模板'}</option>
      {(templates.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
    </Select>}</Field>
    {templates.data?.length === 0 && <p className="m-0 text-[13px] text-ink-muted">还没有模板。可以关闭此窗口，在订阅中直接创建策略组与规则。</p>}
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="模板关联方式">
      {([{ value: 'bound', title: '跟随模板更新', text: '策略组和规则由模板维护，在订阅中填充节点。' }, { value: 'copy', title: '复制后独立维护', text: '复制当前策略组和规则，之后可在订阅中自由修改。' }] as const).map(option => <button key={option.value} type="button" aria-pressed={mode === option.value} disabled={change.isPending} onClick={() => { setMode(option.value); reset(); }} className={cx('flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left', mode === option.value ? 'border-brand bg-accent-soft' : 'border-line hover:bg-ground')}>
        <strong className="text-[13px]">{option.title}</strong><span className="text-[12.5px] leading-relaxed text-ink-muted">{option.text}</span>
      </button>)}
    </div>
    {target && <p className="m-0 text-[13px] text-ink-muted">包含 {target.groups.length} 个策略组、{target.rules.length} 条规则。</p>}
    {target && groups.length > 0 && selected !== currentId && <details className="rounded-lg border border-line p-3" open>
      <summary className="cursor-pointer text-[13px] font-medium">迁移现有节点填充与代理链引用</summary>
      <p className="text-[12px] text-ink-muted">现有策略组和规则将被替换。有节点或代理链引用的组需要选择目标组。</p>
      <div className="flex flex-col gap-3">{groups.map(g => <Field key={g.id} label={g.name}>{id => <Select id={id} value={mapping[g.id] ?? ''} disabled={change.isPending} onChange={e => { setMapping({ ...mapping, [g.id]: e.target.value }); reset(); }}>
        <option value="">选择目标组</option><option value="__drop">不迁移，移除节点填充</option>
        {target.groups.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>}</Field>)}</div>
    </details>}
    {!staged && <div className="flex flex-wrap justify-end gap-2">
      {currentId && <Button disabled={change.isPending || !template} onClick={() => change.mutate('detach')}>解除关联，保留当前配置</Button>}
      <Button variant="primary" disabled={change.isPending || !target || (mode === 'bound' && selected === currentId)} onClick={() => change.mutate(mode)}>{change.isPending ? '正在检查…' : groups.length ? '检查变更' : '使用此模板'}</Button>
    </div>}
    {staged && <div className="flex flex-col gap-3 rounded-lg border border-line bg-ground p-3">
      <strong className="text-[13px]">{staged.item.routing?.mode === 'bound' ? '将跟随所选模板更新' : '将改为独立维护'}</strong>
      <ul className="m-0 pl-5 text-[13px] leading-relaxed">{staged.changes.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <p className="m-0 text-[12px] text-ink-muted">应用后可继续检查和编辑，保存订阅后生效。</p>
      <div className="flex gap-2"><Button variant="primary" onClick={() => apply(staged.item)}>应用变更</Button><Button onClick={() => setStaged(undefined)}>取消变更</Button></div>
    </div>}
  </div>;
}

export function TemplateCard({ bare = false }: { bare?: boolean } = {}) {
  const { draft, template } = useProfile();
  const [open, setOpen] = useState(false);
  const currentId = boundTemplateId(draft);
  const initialized = draft.routing?.mode === 'independent' ? draft.routing.initializedFrom : undefined;
  if (bare) return <AssociationEditor />;
  return <>
    <section aria-label="模板关联" className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line bg-panel px-4.5 py-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-[14px] font-semibold">{currentId ? <Link className="text-ink no-underline hover:text-brand" to={`/templates/${encodeURIComponent(currentId)}`}>{template?.name ?? '关联模板'}</Link> : '独立配置'}</h2><Badge tone={currentId ? 'accent' : 'neutral'}>{currentId ? '跟随模板更新' : '由本订阅维护'}</Badge></div>
        <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">{currentId ? '策略组和规则由模板维护；节点填充仅用于本订阅。模板保存后，下次刷新订阅时更新。' : initialized ? `复制自「${initialized.name ?? initialized.templateId}」，后续修改互不影响。` : '直接编辑策略组和规则，也可以选择模板作为起点。'}</p>
      </div>
      <Button onClick={() => setOpen(true)}>{currentId ? '管理模板关联' : '使用模板'}</Button>
    </section>
    <Dialog open={open} onOpenChange={next => { if (!next) (() => setOpen(false))(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{currentId ? '管理模板关联' : '使用模板'}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      {open && <AssociationEditor onDone={() => setOpen(false)} />}
    </div><DialogFooter>{<Button onClick={() => setOpen(false)}>关闭</Button>}</DialogFooter></DialogContent></Dialog>
  </>;
}
