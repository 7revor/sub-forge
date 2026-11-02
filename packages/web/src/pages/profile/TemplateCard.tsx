import { FileText } from 'lucide-react';
import { RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { Link } from 'react-router';
import type { GroupSpec } from '@sub-forge/core';
import { api } from '../../api.ts';
import { Button, Field, Select } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc, type TemplateDoc } from '../../hooks.ts';
import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '../../modals/index.tsx';
import { useProfile } from './context.ts';
import { boundTemplateId } from './routing.ts';
import { associationRequirements, inferAssociationMapping } from './associationModel.ts';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.tsx';
import { Label } from '../../components/ui/label.tsx';

type Conversion = { item: ProfileDoc; changes: string[] };
type AssociationMode = 'bound' | 'copy' | 'detach';
const MODES = [
  { value: 'bound', title: '跟随模板', detail: '模板更新时自动同步；可以补充成员和前后插入规则' },
  { value: 'copy', title: '复制模板，独立维护', detail: '以模板为起点，之后与模板互不影响' },
  { value: 'detach', title: '解除模板，保留当前内容', detail: '把现在看到的策略组和规则固定下来' },
] as const;
const TemplateAssociationModal = createModal<{ profile: ProfileDoc; groups: GroupSpec[]; template?: TemplateDoc }, ProfileDoc>(function Association({ data, modal }) {
  const [draft] = useModalDraft(data.profile);
  const templates = useModalPresentation(useTemplates());
  const currentId = boundTemplateId(draft);
  const [selected, setSelected] = useModalDraft(currentId ?? '');
  const [mode, setMode] = useModalDraft<AssociationMode>('bound');
  const [mapping, setMapping] = useModalDraft<Record<string, string | null>>({});
  const target = templates.data?.find(t => t.id === selected);
  const automaticMapping = inferAssociationMapping(data.groups, target?.groups ?? []);
  const effectiveMapping = { ...automaticMapping, ...mapping };
  const required = associationRequirements(draft, data.groups, effectiveMapping);
  const unresolved = required.some(g => !Object.hasOwn(effectiveMapping, g.id) || effectiveMapping[g.id] === '' || (!g.canDrop && effectiveMapping[g.id] === null));
  const apply = () => modal.submit(async () => {
    const profile = { ...draft, name: draft.name.trim() || '未命名订阅' };
    let converted: Conversion;
    if (mode === 'detach') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'independent' });
    else {
      if (!target) throw new Error('请先选择模板');
      converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'bound', templateId: target.id, mapping: effectiveMapping });
      if (modal.signal.aborted) return draft;
      if (mode === 'copy') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile: converted.item, mode: 'independent' });
    }
    return { ...converted.item, name: draft.name };
  });
  return <ModalContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
    <ModalHeader className="px-6 pt-5 pb-4"><ModalTitle>更换分流方式</ModalTitle><ModalDescription>只改动策略组与规则；节点来源和代理链保持不变</ModalDescription></ModalHeader>
    <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pb-5">
      <RadioGroup aria-label="分流方式" value={mode} onValueChange={value => setMode(value as typeof mode)} className="gap-4">{MODES.filter(m => m.value !== 'detach' || currentId).map(m => <Label key={m.value} className="cursor-pointer items-start font-normal">
        <RadioGroupItem value={m.value} className="mt-0.5" />
        <span className="grid gap-1"><span className="font-medium">{m.title}</span><span className="text-muted-foreground">{m.detail}</span></span>
      </Label>)}</RadioGroup>
      {mode !== 'detach' && <Field label="模板">{id => <Select id={id} value={selected} placeholder="选择用于订阅的规则模板" onChange={event => { setSelected(event.target.value); setMapping({}); }}>
        {(templates.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name} · {t.groups.length} 个策略组 · {t.rules.length} 条规则</option>)}
      </Select>}</Field>}
      {target && mode !== 'detach' && <section className="border-t border-border pt-4"><h3 className="m-0 mb-3 text-base font-semibold">变更检查</h3>
        <div className="mb-4 flex gap-6 text-sm text-muted-foreground"><span>策略组 {data.groups.length} → {target.groups.length}</span><span>规则 {data.template?.rules.length ?? (draft.routing?.mode === 'independent' ? draft.routing.config.rules.length : 0)} → {target.rules.length}</span></div>
        <p className="mb-3 text-xs text-muted-foreground">同名或同 ID 的组已自动对应，只列出需要你决定的组。</p>
        <div className="flex flex-col gap-4">{required.filter(g => !Object.hasOwn(automaticMapping, g.id)).map(g => {
          const mapped = Object.hasOwn(effectiveMapping, g.id) ? effectiveMapping[g.id] : undefined;
          // 选项值加前缀，避免合法组 ID 与“移除”选项冲突。
          return <Field key={g.id} label={g.name} hint={g.reasons.join('、')}>{id => <Select id={id} clearable value={mapped === null ? '__drop' : mapped ? `group:${mapped}` : ''} placeholder="选择迁移到的策略组" onChange={event => setMapping({ ...mapping, [g.id]: event.target.value === '__drop' ? null : event.target.value.slice(6) })}>
            {g.canDrop && <option value="__drop">移除此组的节点填充</option>}{target.groups.map(g => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
          </Select>}</Field>;
        })}</div>
      </section>}
      {templates.error && <p role="alert" className="text-sm text-destructive">{templates.error.message}<Button size="sm" onClick={() => void templates.refetch()}>重试</Button></p>}
    </div>
    <ModalFooter className="border-t border-border px-6 py-3"><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={modal.pending || (mode === 'detach' ? !data.template : !target || unresolved)} onClick={() => void apply()}>{modal.pending ? '正在应用…' : '应用到草稿'}</Button></ModalFooter>
  </ModalContent>;
});

export function TemplateCard() {
  const { draft, template, groups, setDraft } = useProfile();
  const currentId = boundTemplateId(draft);
  return <section aria-label="模板设置" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card shadow-sm px-5 py-3.5">
    <div className="flex items-center gap-4"><RoutingCardIcon><FileText size={16} /></RoutingCardIcon><span className="text-sm text-muted-foreground">{currentId ? '跟随模板' : '独立维护'}</span>{currentId && <Link className="text-sm font-medium text-primary no-underline hover:text-primary" to={`/templates/${encodeURIComponent(currentId)}`}>{template?.name ?? '关联模板'}</Link>}</div>
    <Button onClick={async () => { const result = await TemplateAssociationModal.show({ profile: draft, groups, template }); if (result.status === 'confirmed') setDraft(result.data); }}>更换分流方式</Button>
  </section>;
}
