// 关联设置在页内按需展开；应用只修改草稿，保存订阅后生效。
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../api.ts';
import { Badge, Button, Field, Select } from '../../components/ui.tsx';
import { useTemplates, type ProfileDoc } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { boundTemplateId, persistedProfile } from './routing.ts';
import { associationRequirements, inferAssociationMapping } from './associationModel.ts';

type Conversion = { item: ProfileDoc; changes: string[] };
type AssociationMode = 'bound' | 'copy' | 'detach';

function TemplateAssociationEditor({ onClose }: { onClose: () => void }) {
  const { draft, template, groups, setDraft } = useProfile();
  const templates = useTemplates();
  const currentId = boundTemplateId(draft);
  const [selected, setSelected] = useState(currentId ?? '');
  const [mode, setMode] = useState<AssociationMode>('bound');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(false);
  const submitting = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const target = templates.data?.find(t => t.id === selected);
  const effectiveMapping = { ...inferAssociationMapping(groups, target?.groups ?? []), ...mapping };
  const required = associationRequirements(draft, groups, effectiveMapping);
  const unresolved = required.some(g => !effectiveMapping[g.id] || (!g.canDrop && effectiveMapping[g.id] === '__drop'));
  const apply = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    const submitted = JSON.stringify(persistedProfile(draft));
    try {
      const profile = persistedProfile({ ...draft, name: draft.name.trim() || '未命名订阅' });
      let converted: Conversion;
      if (mode === 'detach') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'independent' });
      else {
        if (!target) throw new Error('请先选择模板');
        converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile, mode: 'bound', templateId: target.id, mapping: Object.fromEntries(Object.entries(effectiveMapping).map(([id, value]) => [id, value === '__drop' ? null : value])) });
        if (!active.current) return;
        if (mode === 'copy') converted = await api<Conversion>('POST', '/profiles/routing/convert', { profile: converted.item, mode: 'independent' });
      }
      if (!active.current) return;
      // 请求期间的编辑、放弃修改或页面离开不能被晚到结果覆盖。
      if (JSON.stringify(persistedProfile(latest.current)) !== submitted) throw new Error('订阅内容已变化，请检查后重新应用模板设置。');
      setDraft({ ...converted.item, name: draft.name });
      onClose();
    } catch (cause) {
      if (active.current) setError(cause instanceof TypeError ? '网络请求失败，请检查连接后重试。' : cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      if (active.current) setPending(false);
    }
  };
  const modeHint = mode === 'bound' ? '模板组和规则随模板更新；节点填充与独立组保留。'
    : mode === 'copy' ? '复制所选模板的策略组和规则，之后在本订阅中独立修改。'
      : `保留「${template?.name ?? currentId}」的当前策略组、成员和规则，之后独立维护。`;
  return <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Field label="关联方式">{id => <Select id={id} value={mode} placeholder="选择模板的使用方式" onChange={e => { setMode(e.target.value as AssociationMode); setError(undefined); }}>
        <option value="bound">跟随模板更新</option>
        <option value="copy">复制后独立维护</option>
        {currentId && <option value="detach">解除关联</option>}
      </Select>}</Field>
      {mode !== 'detach' && <Field label="模板">{id => <Select clearable id={id} value={selected} placeholder={templates.isLoading ? '正在加载模板…' : '选择用于订阅的规则模板'} disabled={templates.isLoading} onChange={e => { setSelected(e.target.value); setMapping({}); setError(undefined); }}>
        {(templates.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name ?? t.id}</option>)}
      </Select>}</Field>}
    </div>
    <p className="m-0 text-[12px] leading-relaxed text-ink-muted">{modeHint}{mode !== 'detach' && target && ` 共 ${target.groups.length} 个策略组、${target.rules.length} 条规则；替换现有组结构、参数、规则和最终出口，保留节点来源与代理链。`}</p>
    {mode !== 'detach' && templates.data?.length === 0 && <p className="m-0 text-[13px] text-ink-muted">还没有模板。可前往<Link className="text-brand" to="/templates">模板页面</Link>创建，或直接编辑本订阅。</p>}
    {mode !== 'detach' && target && !!required.length && <section className="border-t border-line-2 pt-3">
      <h3 className="mt-0 mb-1 text-[13px] font-semibold">迁移现有填充与引用</h3>
      <p className="mt-0 mb-3 text-[12px] text-ink-muted">已自动匹配同 ID 或唯一同名组；仍被引用的组必须指定迁移目标。</p>
      <div className="grid max-h-64 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {required.map(g => <Field key={g.id} label={g.name} hint={g.reasons.join('、')}>{id => <Select clearable aria-label={`${g.name}的迁移目标`} id={id} value={effectiveMapping[g.id] ?? ''} placeholder="选择迁移到哪个策略组" onChange={e => { setMapping({ ...mapping, [g.id]: e.target.value }); setError(undefined); }}>
          {g.canDrop && <option value="__drop">不迁移此组的节点填充</option>}{target.groups.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>}</Field>)}
      </div>
    </section>}
    {templates.error && mode !== 'detach' && <div role="alert" className="text-[13px] text-err">{templates.error.message}<Button size="sm" onClick={() => void templates.refetch()}>重新加载</Button></div>}
    {error && <p role="alert" className="m-0 text-[13px] text-err">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-2 pt-3">
      <span className="mr-auto text-[12px] text-ink-muted">{mode !== 'detach' && target && unresolved ? '请完成策略组对应关系' : '应用后需保存订阅才会生效'}</span>
      <Button size="sm" onClick={onClose}>取消</Button>
      <Button size="sm" variant="primary" disabled={pending || (mode === 'detach' ? !template : !target || unresolved || (mode === 'bound' && selected === currentId))} onClick={() => void apply()}>{pending ? '正在应用…' : '应用到订阅'}</Button>
    </div>
  </fieldset>;
}

export function TemplateCard() {
  const { draft, template } = useProfile();
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  const currentId = boundTemplateId(draft);
  const initialized = draft.routing?.mode === 'independent' ? draft.routing.initializedFrom : undefined;
  return <section aria-label="模板设置" className="flex min-w-0 flex-col gap-4 rounded-[10px] border border-line bg-panel px-4.5 py-4">
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="m-0 mr-1 text-[12.5px] font-medium text-ink-muted">模板设置</h2>
          <span className="text-[14px] font-semibold [overflow-wrap:anywhere]">{currentId ? <Link className="text-ink no-underline hover:text-brand" to={`/templates/${encodeURIComponent(currentId)}`}>{template?.name ?? '关联模板'}</Link> : '独立配置'}</span>
          <Badge tone={currentId ? 'accent' : 'neutral'}>{currentId ? '跟随模板更新' : '由本订阅维护'}</Badge>
        </div>
        <Button size="sm" variant="ghost" aria-expanded={editing} aria-controls={editing ? editorId : undefined} onClick={() => setEditing(value => !value)}>{editing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{editing ? '收起设置' : currentId ? '调整模板' : '使用模板'}</Button>
      </div>
      {editing ? <div id={editorId} className="pt-1"><TemplateAssociationEditor key={`${draft.id}:${JSON.stringify(draft.routing ?? draft.template)}`} onClose={() => setEditing(false)} /></div>
        : <p className="m-0 text-[12.5px] leading-relaxed text-ink-muted">{currentId ? '模板组和规则随模板更新；节点填充与独立组保留。' : initialized ? `复制自「${initialized.name ?? initialized.templateId}」，后续修改互不影响。` : '直接编辑策略组和规则，也可以选择模板作为起点。'}</p>}
    </div>
  </section>;
}
