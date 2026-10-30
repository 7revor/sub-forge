import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { profileModalData, useModalProfile, type ProfileModalData } from './modalProfile.ts';
// 关联摘要与变更操作分开；转换只影响当前草稿，保存订阅后生效。
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { Badge, Button, Field, Input, Select } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { boundTemplateId, persistedProfile } from './routing.ts';

import { associationRequirements, inferAssociationMapping } from './associationModel.ts';

type Conversion = { item: ProfileDoc; changes: string[] };

const TemplateAssociationModal = createModal<ProfileModalData, ProfileDoc>(function AssociationEditor({ data, modal }) {
  const { ctx } = useModalProfile(data);
  const { draft, template, groups } = ctx;
  const query = useTemplates();
  const templates = useModalPresentation(query);
  const currentId = boundTemplateId(draft);
  const [selected, setSelected] = useModalDraft(currentId ?? '');
  const [mode, setMode] = useModalDraft<'bound' | 'copy' | 'detach'>('bound');
  const [mapping, setMapping] = useModalDraft<Record<string, string>>({});
  const target = templates.data?.find(t => t.id === selected);
  const effectiveMapping = { ...inferAssociationMapping(groups, target?.groups ?? []), ...mapping };
  const required = associationRequirements(draft, groups, effectiveMapping);
  const unresolved = required.some(g => !effectiveMapping[g.id] || (!g.canDrop && effectiveMapping[g.id] === '__drop'));
  const apply = () => modal.submit(async () => {
    const profile = persistedProfile({ ...draft, name: draft.name.trim() || '未命名订阅' });
    let converted: Conversion;
    if (mode === 'detach') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'independent' });
    else {
      if (!target) throw new Error('请先选择模板');
      converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'bound', templateId: target.id, mapping: Object.fromEntries(Object.entries(effectiveMapping).map(([id, value]) => [id, value === '__drop' ? null : value])) });
      if (mode === 'copy') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile: converted.item, mode: 'independent' });
    }
    return { ...converted.item, name: draft.name };
  });
  const options = [
    { value: 'bound' as const, title: '跟随模板更新', text: '策略组和规则由模板维护，在订阅中填充节点。' },
    { value: 'copy' as const, title: '复制后独立维护', text: '复制所选模板的策略组和规则，之后在本订阅中修改。' },
    ...(currentId ? [{ value: 'detach' as const, title: '解除关联', text: '保留当前策略组、成员和规则，之后独立维护。' }] : []),
  ];
  const error = templates.error;
  return <ModalContent className="flex h-[min(680px,calc(100dvh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" aria-describedby={undefined}><ModalHeader className="shrink-0 border-b border-line px-5 py-4"><ModalTitle>{currentId ? '管理模板关联' : '使用模板'}</ModalTitle></ModalHeader>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
      <fieldset disabled={modal.pending} className="m-0 flex flex-col gap-3 border-0 p-0"><legend className="mb-2 text-[13px] font-semibold">关联方式</legend>
        {options.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md py-1">
          <input type="radio" name="association-mode" value={option.value} checked={mode === option.value} onChange={() => { setMode(option.value); }} className="mt-1 accent-brand" />
          <span><strong className="block text-[13px]">{option.title}</strong><span className="mt-1 block text-[12px] text-ink-muted">{option.text}</span></span>
        </label>)}
      </fieldset>
      {mode !== 'detach' && <>
        <Field label="模板">{id => <Select clearable aria-label="模板" id={id} value={selected} placeholder={templates.isLoading ? '正在加载模板…' : '选择用于订阅的规则模板'} disabled={modal.pending || templates.isLoading} onChange={e => { setSelected(e.target.value); setMapping({}); }}>
          {(templates.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
        </Select>}</Field>
        {templates.data?.length === 0 && <p className="m-0 text-[13px] text-ink-muted">还没有模板。可在模板页面创建，或取消后直接编辑订阅。</p>}
        {target && <div className="text-[13px] leading-relaxed"><strong>{target.name ?? target.id}</strong><span className="ml-2 text-ink-muted">{target.groups.length} 个策略组 · {target.rules.length} 条规则</span><p className="mt-1 mb-0 text-[12px] text-ink-muted">将使用此模板的策略组、参数、规则和最终出口。现有节点来源与代理链保留。</p></div>}
        {target && !!required.length && <section className="border-t border-line pt-4"><h3 className="mt-0 mb-2 text-[13px] font-semibold">迁移现有填充与引用</h3><p className="mt-0 mb-3 text-[12px] text-ink-muted">相同 ID 或唯一同名组已匹配，可在此调整。被代理链等引用的组必须保留对应关系。</p><div className="flex flex-col gap-3">
          {required.map(g => <Field key={g.id} label={`${g.name} · ${g.reasons.join('、')}`}>{id => <Select clearable aria-label={`${g.name}的迁移目标`} id={id} value={effectiveMapping[g.id] ?? ''} placeholder="选择迁移到哪个策略组" disabled={modal.pending} onChange={e => { setMapping({ ...mapping, [g.id]: e.target.value }); }}>
            {g.canDrop && <option value="__drop">不迁移此组的节点填充</option>}{target.groups.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>}</Field>)}
        </div></section>}
      </>}
      {mode === 'detach' && <p className="m-0 text-[13px] text-ink-muted">当前「{template?.name ?? currentId}」的完整配置将复制到本订阅。</p>}
      {error && <div role="alert" className="text-[13px] text-err">{error.message}{templates.error && <Button size="sm" onClick={() => void templates.refetch()}>重新加载</Button>}</div>}
    </div>
    <ModalFooter className="h-[65px] shrink-0 flex-row flex-wrap items-center justify-end border-t border-line bg-ground px-5 py-3">{mode !== 'detach' && target && unresolved && <span className="mr-auto self-center text-[12px] text-ink-muted">请完成上方策略组对应关系</span>}<Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={modal.pending || (mode === 'detach' ? !template : !target || unresolved || (mode === 'bound' && selected === currentId))} onClick={() => void apply()}>{modal.pending ? '正在应用…' : '应用到订阅'}</Button></ModalFooter>
  </ModalContent>;
});

export function TemplateCard() {
  const ctx = useProfile();
  const { draft, template, setDraft } = ctx;
  const edit = async () => {
    const result = await TemplateAssociationModal.show(profileModalData(ctx));
    if (result.status === 'confirmed') setDraft(result.data);
  };
  const currentId = boundTemplateId(draft);
  const initialized = draft.routing?.mode === 'independent' ? draft.routing.initializedFrom : undefined;
  return <>
    <section aria-label="订阅名称与模板设置" className="grid min-w-0 gap-4 rounded-[10px] border border-line bg-panel px-4.5 py-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <Field label="订阅名称" hint="同时用作客户端中的显示名。">{id => <Input id={id} required placeholder="例如：日常使用" value={draft.name} aria-invalid={!!draft.id && !draft.name.trim()} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
        {!!draft.id && !draft.name.trim() && <p role="alert" className="mt-1 mb-0 text-[12px] text-err">请填写订阅名称</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 border-t border-line-2 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
        <h2 className="m-0 text-[12.5px] font-medium text-ink-muted">模板设置</h2>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[14px] font-semibold [overflow-wrap:anywhere]">{currentId ? <Link className="text-ink no-underline hover:text-brand" to={`/templates/${encodeURIComponent(currentId)}`}>{template?.name ?? '关联模板'}</Link> : '独立配置'}</span><Badge tone={currentId ? 'accent' : 'neutral'}>{currentId ? '跟随模板更新' : '由本订阅维护'}</Badge></div>
          <Button size="sm" onClick={() => void edit()}>{currentId ? '管理模板关联' : '使用模板'}</Button>
        </div>
        <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">{currentId ? '策略组和规则由模板维护；节点填充仅用于本订阅。模板保存后，下次刷新订阅时更新。' : initialized ? `复制自「${initialized.name ?? initialized.templateId}」，后续修改互不影响。` : '直接编辑策略组和规则，也可以选择模板作为起点。'}</p>
      </div>
    </section>
  </>;
}
