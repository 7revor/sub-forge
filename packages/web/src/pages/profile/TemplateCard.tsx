// 模式转换先展示变更草稿，应用后仍由订阅页面统一保存。
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, ErrorAlert, Field, Select } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { boundTemplateId, modeLabel, persistedProfile } from './routing.ts';

type Conversion = { item: ProfileDoc; changes: string[] };

export function TemplateCard({ bare = false }: { bare?: boolean } = {}) {
  const { draft, setDraft, template, groups } = useProfile();
  const templates = useTemplates();
  const currentId = boundTemplateId(draft);
  const [selected, setSelected] = useState(currentId ?? '');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<Conversion>();
  const target = templates.data?.find(t => t.id === selected);
  const change = useMutation({
    mutationFn: async (action: 'bound' | 'copy' | 'detach') => {
      const profile = persistedProfile(draft);
      if (action === 'detach') return api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'independent' });
      if (!target) throw new Error('请先选择模板');
      const effectiveMapping = Object.fromEntries(groups.flatMap(g => {
        const value = mapping[g.id] ?? (selected === currentId && target.groups.some(t => t.id === g.id) ? g.id : '');
        return value ? [[g.id, value === '__drop' ? null : value]] : [];
      }));
      const bound = await api<Conversion>('POST', '/profiles/routing/convert', {
        profile, mode: 'bound', templateId: target.id, mapping: effectiveMapping,
      });
      if (action === 'bound') return bound;
      const independent = await api<Conversion>('POST', '/profiles/routing/convert', { profile: bound.item, mode: 'independent' });
      return { ...independent, changes: [...bound.changes, ...independent.changes] };
    },
    onSuccess: setStaged,
  });
  const initialized = draft.routing?.mode === 'independent' ? draft.routing.initializedFrom : undefined;
  const body = <div className="flex flex-col gap-3.5">
    <p className="m-0 text-[13px] font-medium">{modeLabel(draft, template?.name)}</p>
    <p className="m-0 text-[13px] text-muted">{currentId ? '模板维护分流结构，订阅只补充成员；模板保存后，下次刷新主订阅时更新。' : '策略组和规则由本订阅维护。节点源和远程规则内容仍可更新。'}</p>
    {initialized && <p className="m-0 text-[12px] text-muted">初始化自 {initialized.name ?? initialized.templateId}</p>}
    <ErrorAlert error={templates.error ?? change.error} />
    {currentId && <Button disabled={change.isPending || !template} onClick={() => change.mutate('detach')}>转为独立配置</Button>}
    <Field label="选择模板">{id => <Select id={id} value={selected} disabled={change.isPending} onChange={e => { setSelected(e.target.value); setMapping({}); setStaged(undefined); change.reset(); }}>
      <option value="">选择模板</option>
      {(templates.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
    </Select>}</Field>
    {target && <>
      {groups.length > 0 && <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">成员与代理链引用映射</span>
        <p className="m-0 text-[12px] text-muted">为有节点或引用的原策略组选择目标；不迁移会移除相应成员。独立配置的规则和组参数将被所选模板替换。</p>
        {groups.map(g => <Field key={g.id} label={g.name}>{id => <Select id={id} value={mapping[g.id] ?? (selected === currentId && target.groups.some(t => t.id === g.id) ? g.id : '')} disabled={change.isPending}
          onChange={e => { setMapping({ ...mapping, [g.id]: e.target.value }); setStaged(undefined); }}>
          <option value="">选择目标组</option><option value="__drop">不迁移（移除追加成员）</option>
          {target.groups.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>}</Field>)}
      </div>}
      <div className="flex flex-wrap gap-2"><Button disabled={change.isPending} onClick={() => change.mutate('bound')}>绑定模板，自动更新</Button>
        <Button disabled={change.isPending} onClick={() => change.mutate('copy')}>复制模板，独立维护</Button></div>
    </>}
    {change.isPending && <p className="m-0 text-[13px] text-muted">正在检查转换…</p>}
    {staged && <div className="flex flex-col gap-3 rounded-lg border border-line bg-ground p-3">
      <strong className="text-[13px]">转换预览 · {staged.item.routing?.mode === 'bound' ? '绑定模板' : '独立配置'}</strong>
      <ul className="m-0 pl-5 text-[13px]">{staged.changes.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <p className="m-0 text-[12px] text-muted">应用到草稿后可检查策略组、规则和配置预览，完成订阅保存后生效。</p>
      <div className="flex gap-2"><Button variant="primary" onClick={() => { setDraft(staged.item); setStaged(undefined); }}>应用到草稿</Button><Button onClick={() => setStaged(undefined)}>取消</Button></div>
    </div>}
  </div>;
  return bare ? body : <Card title="模板与模式">{body}</Card>;
}
