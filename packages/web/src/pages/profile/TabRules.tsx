// 模板规则只改启用和出口；私有规则支持拖拽、匹配项及客户端覆盖编辑。

import type { Matcher, RuleEntry, RuleIR, Target } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ClientOverrides, clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { TargetPicker, targetLabel } from '../../components/pickers.tsx';
import { RuleEditor } from '../../components/RuleEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, Select, Switch, cx } from '../../components/ui.tsx';
import { useList } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { mergeRuleRows, ruleRowsToExtraRules, type ExtraRule } from './ruleOrder.ts';

export function ruleText(r: RuleIR): string {
  switch (r.type) {
    case 'PROCESS': return `进程 ${r.kind === 'name' ? '名称' : '路径'} · ${{ exact: '精确', wildcard: '通配', regex: '正则' }[r.mode]} · ${r.value}`;
    case 'AND': case 'OR': case 'NOT': return `${r.type}(…)`;
    case 'RAW': return `${r.client} 原样：${r.text}`;
    default: return `${r.type},${r.value}${'noResolve' in r && r.noResolve ? ',no-resolve' : ''}`;
  }
}

function useMatcherLabel() {
  const rulesets = useList('rulesets').data ?? [];
  const bundles = useList('bundles').data ?? [];
  return (m: Matcher): { kind: string; text: string } => {
    if (m.kind === 'rule') return { kind: '单条规则', text: ruleText(m.rule) };
    if (m.kind === 'ruleset') return { kind: '规则集', text: rulesets.find((r) => r.id === m.id)?.name ?? m.id };
    return { kind: '规则包', text: bundles.find((b) => b.id === m.id)?.name ?? m.id };
  };
}

function privateRuleError(rule: RuleEntry): string | undefined {
  const matcher = rule.matcher;
  return matcher.kind === 'rule' ? ruleInputError(matcher.rule) ?? clientOverridesError(matcher.overrides ?? []) : matcher.id ? undefined : '请选择规则集或规则包。';
}

function PrivateRuleFields({ value, onChange }: { value: RuleEntry; onChange: (value: RuleEntry) => void }) {
  const { groupOptions, profileNodeSets } = useProfile();
  const rulesets = useList('rulesets').data ?? [];
  const bundles = useList('bundles').data ?? [];
  const matcher = value.matcher;
  const options = matcher.kind === 'ruleset' ? rulesets : bundles;
  const changeRule = (rule: RuleIR) => {
    if (matcher.kind === 'rule') onChange({ ...value, matcher: { ...matcher, rule } });
  };
  return <div className="flex flex-col gap-3.5">
    <Field label="匹配项">{(id) => <Select id={id} value={matcher.kind} onChange={(e) => {
      const kind = e.target.value as Matcher['kind'];
      const { rule: _, id: __, overrides: ___, ...rest } = matcher as { rule?: RuleIR; id?: string; overrides?: unknown };
      onChange({ ...value, matcher: kind === 'rule' ? { ...rest, kind, rule: { type: 'DOMAIN', value: '' } } : { ...rest, kind, id: '' } });
    }}><option value="rule">单条规则</option><option value="ruleset">规则集</option><option value="bundle">规则包</option></Select>}</Field>
    {matcher.kind === 'rule' ? <RuleEditor value={matcher.rule} onChange={changeRule} onIncomplete={changeRule} /> :
      <Field label={matcher.kind === 'ruleset' ? '规则集' : '规则包'}>{(id) => <Select id={id} value={matcher.id} onChange={(e) => onChange({ ...value, matcher: { ...matcher, id: e.target.value } })}>
        <option value="">请选择</option>
        {matcher.id && !options.some((item) => item.id === matcher.id) && <option value={matcher.id}>{matcher.id}（当前不可用）</option>}
        {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>}</Field>}
    <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">出口</span>
      <TargetPicker label="出口" value={value.target} onChange={(target) => onChange({ ...value, target })} groups={groupOptions} nodeSets={profileNodeSets} /></div>
    <div className="flex flex-wrap gap-5">
      <label className="flex items-center gap-2 text-[13px]"><Switch label="规则级 no-resolve" checked={value.options?.noResolve === true}
        onChange={(noResolve) => onChange({ ...value, options: { ...value.options, noResolve } })} />no-resolve</label>
      <label className="flex items-center gap-2 text-[13px]"><Switch label="规则级 src" checked={value.options?.src === true}
        onChange={(src) => onChange({ ...value, options: { ...value.options, src } })} />src</label>
    </div>
    {matcher.kind === 'rule' && <details>
      <summary className="cursor-pointer text-[13px] font-medium">客户端覆盖（{matcher.overrides?.length ?? 0} 条）</summary>
      <div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={(overrides) => onChange({ ...value, matcher: { ...matcher, overrides } })} /></div>
    </details>}
  </div>;
}

function ExtraRuleModal({ onClose, onAdd }: { onClose: () => void; onAdd: (anchor: ExtraRule['anchor'], rule: RuleEntry) => void }) {
  const { template } = useProfile();
  const [anchor, setAnchor] = useState('top');
  const [rule, setRule] = useState<RuleEntry>(() => ({ id: `p_${crypto.randomUUID()}`, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: '' } }, target: { kind: 'builtin', name: 'DIRECT' }, enabled: true }));
  const error = privateRuleError(rule);
  return <Modal title="插入私有规则" open onClose={onClose} wide footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!!error} onClick={() => {
    const position: ExtraRule['anchor'] = anchor === 'top' || anchor === 'bottom' ? anchor : anchor.startsWith('before:') ? { before: anchor.slice(7) } : { after: anchor.slice(6) };
    onAdd(position, rule); onClose();
  }}>插入</Button></>}>
    <Field label="位置">{(id) => <Select id={id} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
      <option value="top">最前面</option><option value="bottom">最后面（MATCH 之前）</option>
      {(template?.rules ?? []).map((r, i) => <option key={`b${r.id}`} value={`before:${r.id}`}>模板规则 #{i + 1} 之前</option>)}
      {(template?.rules ?? []).map((r, i) => <option key={`a${r.id}`} value={`after:${r.id}`}>模板规则 #{i + 1} 之后</option>)}
    </Select>}</Field>
    <PrivateRuleFields value={rule} onChange={setRule} />
    <ErrorBox error={error} />
  </Modal>;
}

function PrivateRuleEdit({ rule, onApply, onClose }: { rule: RuleEntry; onApply: (rule: RuleEntry) => void; onClose: () => void }) {
  const [value, setValue] = useState(rule);
  const error = privateRuleError(value);
  return <div className="flex flex-col gap-3 border-t border-line-2 bg-ground p-4">
    <p className="m-0 text-[12.5px] text-muted">编辑后点击「应用修改」，再保存 Profile。</p>
    <PrivateRuleFields value={value} onChange={setValue} />
    <ErrorBox error={error} />
    <div className="flex gap-2"><Button variant="primary" disabled={!!error} onClick={() => { onApply(value); onClose(); }}>应用修改</Button><Button onClick={onClose}>取消</Button></div>
  </div>;
}

export function TabRules() {
  const { draft, template, patchOverlay, groupOptions, groupName, profileNodeSets, nodeSetName } = useProfile();
  const label = useMatcherLabel();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const patches = draft.overlay.rulePatches ?? {};
  const orphans = Object.keys(patches).filter((id) => !template?.rules.some((r) => r.id === id));
  const rows = mergeRuleRows(template?.rules ?? [], draft.overlay);
  const final = draft.overlay.final ?? template?.final ?? { kind: 'builtin' as const, name: 'DIRECT' as const };
  const patchRule = (id: string, p: { enabled?: boolean; target?: Target }) => patchOverlay((o) => ({ ...o, rulePatches: { ...o.rulePatches, [id]: { ...(o.rulePatches?.[id] ?? {}), ...p } } }));
  const setExtra = (id: string, fn: (r: RuleEntry) => RuleEntry | undefined) => patchOverlay((o) => ({
    ...o,
    extraRules: (o.extraRules ?? []).flatMap((e) => { if (e.rule.id !== id) return [e]; const r = fn(e.rule); return r ? [{ ...e, rule: r }] : []; }),
  }));

  return <>
    {orphans.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-4 py-3 text-[#6b3406]">
      <span className="text-[13px]"><b>{orphans.length} 个孤儿覆盖项不再输出：</b>模板已删除对应的规则。</span>
      <Button size="sm" onClick={() => patchOverlay((o) => ({ ...o, rulePatches: Object.fromEntries(Object.entries(o.rulePatches ?? {}).filter(([id]) => !orphans.includes(id))) }))}>清理</Button>
    </div>}
    <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">规则（自上而下匹配）</h2><span className="text-[12.5px] text-muted">继承自模板 · 可禁用、改出口为已加入的节点、在锚点前后插入私有规则；点击行展开编辑。</span></div>}
      actions={<Button onClick={() => setAdding(true)}><Plus size={15} />插入私有规则</Button>}>
      {!rows.length ? <Empty title="没有规则" description="所有流量走 MATCH。" /> : <SortableList items={rows} getKey={(r) => r.id} isLocked={(r) => r.origin === 'template'}
        onReorder={(ordered) => patchOverlay((o) => ({ ...o, extraRules: ruleRowsToExtraRules(ordered, o.extraRules) }))}
        renderItem={(r, i, handle) => {
          const l = label(r.matcher);
          const overridden = r.origin === 'template' && patches[r.id]?.target;
          const off = r.enabled === false;
          return <div className="border-t border-line-2">
            <div className={cx('flex flex-wrap items-center gap-3 py-3', off && 'bg-ground', r.origin === 'profile' && 'cursor-pointer')}
              onClick={() => { if (r.origin === 'profile') setEditing(r.id); }}>
              <span onClick={(e) => e.stopPropagation()}>{handle}</span>
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-2 text-left" aria-expanded={editing === r.id}
                onClick={(e) => { e.stopPropagation(); setEditing(editing === r.id ? undefined : r.id); }}>
                <Badge>{l.kind}</Badge><span className={cx('break-all font-mono text-[13px]', off && 'line-through')}>{l.text}</span>
              </button>
              <button type="button" className="cursor-pointer text-left text-[13px] font-medium hover:text-accent" onClick={() => setEditing(r.id)}>
                {targetLabel(r.target, groupName, nodeSetName)}{overridden && <span className="ml-2 text-[12px] font-normal text-accent">已改出口</span>}
              </button>
              <Badge tone={r.origin === 'profile' ? 'ok' : 'neutral'}>{r.origin === 'profile' ? '私有' : '模板'}</Badge>
              <span className="flex gap-1" aria-label="客户端输出"><span className="rounded border border-line bg-ground px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">mihomo</span><span className="rounded border border-dashed border-line px-1.5 py-0.5 font-mono text-[11.5px] text-faint" title="Surge 在 M2 输出">Surge</span></span>
              <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                <Switch label={`启用规则 ${i + 1}`} checked={!off} onChange={(enabled) => r.origin === 'template' ? patchRule(r.id, { enabled }) : setExtra(r.id, (rule) => ({ ...rule, enabled }))} />
                {r.origin === 'profile' && <Button size="sm" variant="ghost" aria-label={`删除私有规则 ${i + 1}`} onClick={() => { setExtra(r.id, () => undefined); if (editing === r.id) setEditing(undefined); }}><Trash2 size={14} /></Button>}
              </span>
            </div>
            {editing === r.id && (r.origin === 'profile' ? <PrivateRuleEdit key={r.id} rule={draft.overlay.extraRules!.find((e) => e.rule.id === r.id)!.rule}
              onApply={(value) => setExtra(r.id, (current) => ({ ...value, enabled: current.enabled }))} onClose={() => setEditing(undefined)} /> :
              <div className="flex flex-col gap-2 pb-3">
                <TargetPicker label="出口" value={r.target} groups={groupOptions} nodeSets={profileNodeSets} onChange={(target) => patchRule(r.id, { target })} />
                <div className="flex gap-2"><Button size="sm" onClick={() => setEditing(undefined)}>完成</Button>
                  {overridden && <Button size="sm" variant="ghost" onClick={() => { patchOverlay((o) => { const { target: _, ...rest } = o.rulePatches?.[r.id] ?? {}; return { ...o, rulePatches: { ...o.rulePatches, [r.id]: rest } }; }); setEditing(undefined); }}>还原为模板出口</Button>}
                </div>
              </div>)}
          </div>;
        }} />}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <span className="font-mono text-[13px]">MATCH</span>
        <TargetPicker label="MATCH 出口" value={final} groups={groupOptions} nodeSets={profileNodeSets} onChange={(target) => patchOverlay((o) => ({ ...o, final: target }))} />
        {draft.overlay.final && <Button size="sm" variant="ghost" onClick={() => patchOverlay((o) => { const { final: _, ...rest } = o; return rest; })}>还原为模板</Button>}
      </div>
    </Card>
    {adding && <ExtraRuleModal onClose={() => setAdding(false)} onAdd={(anchor, rule) => patchOverlay((o) => ({ ...o, extraRules: [...(o.extraRules ?? []), { anchor, rule }] }))} />}
  </>;
}
