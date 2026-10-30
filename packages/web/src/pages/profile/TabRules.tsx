import { matchesNameSearch } from '@sub-forge/core';
import { ruleToLine } from '../../components/rule.ts';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { Notice } from '../../components/Notice.tsx';
// 绑定模板规则只读；前置单条规则与独立规则复用全局编辑器。

import { withIpOptions, type Matcher, type RuleEntry, type RuleIR, type Target } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ClientOverrides, clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { TargetPicker, targetLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Badge, Button, Card, Empty, FieldError, Field, Input, Modal, Select, Switch, cx } from '../../components/ui.tsx';
import { useRuleSetRefs } from '../../hooks.ts';
import { useProfile } from './context.ts';
import { mergeRuleRows, ruleRowsToExtraRules, type ExtraRule } from './ruleOrder.ts';

export function ruleText(r: RuleIR): string {
  return ruleToLine(r);
}

function useMatcherLabel() {
  const rulesets = useRuleSetRefs().data ?? [];
  return (m: Matcher): { kind: string; text: string } => {
    if (m.kind === 'rule') return { kind: '静态规则', text: ruleText(m.rule) };
    if (m.remote) return { kind: '远程 URL', text: m.remote.url };
    return { kind: '系统规则集', text: m.repository?.name ?? `本地 · ${rulesets.find((r) => r.id === m.id)?.name ?? m.id}` };
  };
}

function privateRuleError(rule: RuleEntry): string | undefined {
  const matcher = rule.matcher;
  if (rule.target.kind === 'group' && !rule.target.groupId) return '请选择规则出口。';
  if (rule.target.kind === 'node') {
    const ref = rule.target.ref;
    const match = 'exact' in ref.match ? ref.match.exact : ref.match.regex;
    if (!ref.nodeSet.id || !match.trim()) return '请选择规则出口。';
  }
  return matcher.kind === 'rule' ? ruleInputError(matcher.rule) ?? clientOverridesError(matcher.overrides ?? []) : matcher.id ? undefined : matcher.remote ? '请填写远程规则 URL。' : '请选择规则集。';
}

function PrivateRuleFields({ value, onChange, single = false }: { value: RuleEntry; onChange: (value: RuleEntry) => void; single?: boolean }) {
  const { groupOptions, profileNodeSets } = useProfile();
  const rulesets = useRuleSetRefs().data ?? [];
  const matcher = value.matcher;
  return <div className="flex flex-col gap-3.5">
    <MatcherEditor fixedKind={single} value={matcher} rulesets={rulesets}
      ruleValue={matcher.kind === 'rule' ? withIpOptions(matcher.rule, value.options ?? {}) : undefined}
      onRuleChange={(rule) => {
        if (matcher.kind !== 'rule') return;
        const { noResolve: _noResolve, src: _src, ...options } = value.options ?? {};
        onChange({ ...value, matcher: { ...matcher, rule }, ...(value.options ? { options } : {}) });
      }} onChange={(matcher) => onChange({ ...value, matcher })} />
    <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">出口</span>
      <TargetPicker label="出口" value={value.target} onChange={(target) => onChange({ ...value, target })} groups={groupOptions} nodeSets={profileNodeSets} /></div>
    {matcher.kind === 'ruleset' && <div className="flex flex-wrap gap-5">
      <label className="flex items-center gap-2 text-[13px]"><Switch label="规则级 src" checked={value.options?.src === true}
        onChange={(src) => onChange({ ...value, options: { ...value.options, src } })} />src</label>
    </div>}
    {matcher.kind === 'rule' && <details>
      <summary className="cursor-pointer text-[13px] font-medium">客户端覆盖（{matcher.overrides?.length ?? 0} 条）</summary>
      <div className="mt-3"><ClientOverrides value={matcher.overrides ?? []} onChange={(overrides) => onChange({ ...value, matcher: { ...matcher, overrides } })} /></div>
    </details>}
  </div>;
}

function ExtraRuleModal({ open, onClose, onAdd, prepend = false }: { open: boolean; onClose: () => void; onAdd: (anchor: ExtraRule['anchor'], rule: RuleEntry) => void; prepend?: boolean }) {
  const { template } = useProfile();
  const [anchor, setAnchor] = useState('top');
  const [rule, setRule] = useState<RuleEntry>(() => ({ id: `p_${crypto.randomUUID()}`, matcher: { kind: 'rule', rule: { type: 'RAW', text: '' } }, target: { kind: 'builtin', name: 'DIRECT' } }));
  useEffect(() => { if (open) { setAnchor('top'); setRule({ id: `p_${crypto.randomUUID()}`, matcher: { kind: 'rule', rule: { type: 'RAW', text: '' } }, target: { kind: 'builtin', name: 'DIRECT' } }); } }, [open]);
  const error = privateRuleError(rule);
  return <Modal title={prepend ? "添加前置规则" : "插入规则"} open={open} onClose={onClose} wide footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!!error} onClick={() => {
    const position: ExtraRule['anchor'] = prepend ? 'top' : anchor === 'top' || anchor === 'bottom' ? anchor : anchor.startsWith('before:') ? { before: anchor.slice(7) } : { after: anchor.slice(6) };
    onAdd(position, rule); onClose();
  }}>插入</Button></>}>
    {!prepend && <Field label="位置">{(id) => <Select id={id} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
      <option value="top">最前面</option><option value="bottom">最后面（MATCH 之前）</option>
      {(template?.rules ?? []).map((r, i) => <option key={`b${r.id}`} value={`before:${r.id}`}>模板规则 #{i + 1} 之前</option>)}
      {(template?.rules ?? []).map((r, i) => <option key={`a${r.id}`} value={`after:${r.id}`}>模板规则 #{i + 1} 之后</option>)}
    </Select>}</Field>}
    <PrivateRuleFields single={prepend} value={rule} onChange={setRule} />
    <FieldError error={error} />
  </Modal>;
}

function PrivateRuleEdit({ rule, onApply, onClose, single = false }: { rule: RuleEntry; onApply: (rule: RuleEntry) => void; onClose: () => void; single?: boolean }) {
  const [value, setValue] = useState(rule);
  const error = privateRuleError(value);
  return <div className="flex flex-col gap-3 border-t border-line-2 bg-ground p-4">
    <PrivateRuleFields single={single} value={value} onChange={setValue} />
    <FieldError error={error} />
    <div className="flex gap-2"><Button variant="primary" disabled={!!error} onClick={() => { onApply(value); onClose(); }}>应用修改</Button><Button onClick={onClose}>取消</Button></div>
  </div>;
}

export function TabRules() {
  const { draft, template, patchOverlay, groupOptions, groupName, profileNodeSets, nodeSetName } = useProfile();
  const label = useMatcherLabel();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [search, setSearch] = useState('');
  const bound = draft.routing?.mode === 'bound';
  const prependRules = draft.routing?.mode === 'bound' ? draft.routing.prependRules ?? [] : [];
  const patches = draft.overlay.rulePatches ?? {};
  const orphans = Object.keys(patches).filter((id) => !template?.rules.some((r) => r.id === id));
  const rows = mergeRuleRows(template?.rules ?? [], draft.overlay);
  const final = draft.overlay.final ?? template?.final ?? { kind: 'builtin' as const, name: 'DIRECT' as const };
  const patchRule = (id: string, p: { target?: Target }) => patchOverlay((o) => ({ ...o, rulePatches: { ...o.rulePatches, [id]: { ...(o.rulePatches?.[id] ?? {}), ...p } } }));
  const setExtra = (id: string, fn: (r: RuleEntry) => RuleEntry | undefined) => patchOverlay((o) => ({
    ...o,
    extraRules: (o.extraRules ?? []).flatMap((e) => { if (e.rule.id !== id) return [e]; const r = fn(e.rule); return r ? [{ ...e, rule: r }] : []; }),
  }));

  if (bound) return <>
    <Card title="前置规则" actions={<Button onClick={() => setAdding(true)}><Plus size={15} />添加前置规则</Button>}>
      {!prependRules.length ? <Empty title="没有前置规则" /> : <SortableList items={prependRules} getKey={rule => rule.id}
        onReorder={prependRules => patchOverlay(o => ({ ...o, extraRules: [...prependRules].reverse().map(rule => ({ anchor: 'top', rule })) }))}
        renderItem={(rule, index, handle) => <div className="border-t border-line-2">
          <div className="flex flex-wrap items-center gap-3 py-3">
            {handle}<span className="font-mono text-[12px] text-muted">{index + 1}</span>
            <button type="button" aria-expanded={editing === rule.id} className="min-w-0 flex-1 cursor-pointer break-all text-left font-mono text-[13px]"
              onClick={() => setEditing(editing === rule.id ? undefined : rule.id)}>{label(rule.matcher).text}</button>
            <button type="button" className="cursor-pointer text-left text-[13px] hover:text-accent" onClick={() => setEditing(rule.id)}>{targetLabel(rule.target, groupName, nodeSetName)}</button>
            <Button size="sm" variant="ghost" aria-label={`删除前置规则 ${index + 1}`} onClick={() => { setExtra(rule.id, () => undefined); if (editing === rule.id) setEditing(undefined); }}><Trash2 size={14} /></Button>
          </div>
          {editing === rule.id && <PrivateRuleEdit single key={rule.id} rule={rule} onApply={value => setExtra(rule.id, () => value)} onClose={() => setEditing(undefined)} />}
        </div>} />}
    </Card>
    <Card title="模板规则" subtitle="顺序与出口跟随模板更新" bodyClass="flex flex-col gap-4 px-4 pb-4">
      <Input aria-label="搜索规则" placeholder="搜索规则或出口" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="divide-y divide-line-2">
        {(template?.rules ?? []).filter(r => matchesNameSearch(`${label(r.matcher).text} ${targetLabel(r.target, groupName, nodeSetName)}`, search)).map(r => <div key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)_minmax(80px,auto)]">
          <Badge>模板</Badge>
          <span className="min-w-0 break-all font-mono leading-6">{label(r.matcher).text}</span>
          <span className="col-start-2 min-w-0 break-words text-ink-2 sm:col-start-auto sm:text-right">{targetLabel(r.target, groupName, nodeSetName)}</span>
        </div>)}
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-line-2 pt-4 text-[13px]">
        <span className="font-mono">MATCH</span><span className="min-w-0 break-words text-right text-ink-2">{targetLabel(final, groupName, nodeSetName)}</span>
      </div>
    </Card>
    <ExtraRuleModal open={adding} prepend onClose={() => setAdding(false)} onAdd={(anchor, rule) => patchOverlay(o => ({ ...o, extraRules: [{ anchor, rule }, ...(o.extraRules ?? [])] }))} />
  </>;

  return <>
    {orphans.length > 0 && <Notice tone="warn" actions={<Button size="sm" onClick={() => patchOverlay((o) => ({ ...o, rulePatches: Object.fromEntries(Object.entries(o.rulePatches ?? {}).filter(([id]) => !orphans.includes(id))) }))}>清理</Button>}><span className="text-[13px]"><b>{orphans.length} 个孤儿覆盖项不再输出：</b>模板已删除对应的规则。</span></Notice>}
    <Card title={`规则（自上而下匹配）`}
      actions={<Button onClick={() => setAdding(true)}><Plus size={15} />插入规则</Button>}>
      {!rows.length ? <Empty title="没有规则" description="未匹配的流量走 MATCH。" /> : <SortableList items={rows} getKey={(r) => r.id} isLocked={(r) => r.origin === 'template'}
        onReorder={(ordered) => patchOverlay((o) => ({ ...o, extraRules: ruleRowsToExtraRules(ordered, o.extraRules) }))}
        renderItem={(r, i, handle) => {
          const l = label(r.matcher);
          const overridden = r.origin === 'template' && patches[r.id]?.target;
          return <div className="border-t border-line-2">
            <div className={cx('flex flex-wrap items-center gap-3 py-3', r.origin === 'profile' && 'cursor-pointer')}
              onClick={() => { if (r.origin === 'profile') setEditing(r.id); }}>
              <span onClick={(e) => e.stopPropagation()}>{handle}</span>
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
              <button type="button" className="flex w-[calc(100%-64px)] min-w-0 flex-none cursor-pointer flex-wrap items-center gap-2 text-left sm:w-auto sm:flex-1" aria-expanded={editing === r.id}
                onClick={(e) => { e.stopPropagation(); setEditing(editing === r.id ? undefined : r.id); }}>
                <Badge>{l.kind}</Badge><span className="break-all font-mono text-[13px]">{l.text}</span>
              </button>
              <button type="button" className="cursor-pointer text-left text-[13px] font-medium hover:text-accent" onClick={() => setEditing(r.id)}>
                {targetLabel(r.target, groupName, nodeSetName)}{overridden && <span className="ml-2 text-[12px] font-normal text-accent">已改出口</span>}
              </button>
              <Badge tone={r.origin === 'profile' ? 'ok' : 'neutral'}>{r.origin === 'profile' ? '私有' : '模板'}</Badge>
              <span className="flex gap-1" aria-label="客户端输出"><span className="rounded border border-line bg-ground px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">mihomo</span><span className="rounded border border-dashed border-line px-1.5 py-0.5 font-mono text-[11.5px] text-faint" title="Surge 暂未开放">Surge</span></span>
              <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                {r.origin === 'profile' && <Button size="sm" variant="ghost" aria-label={`删除规则 ${i + 1}`} onClick={() => { setExtra(r.id, () => undefined); if (editing === r.id) setEditing(undefined); }}><Trash2 size={14} /></Button>}
              </span>
            </div>
            {editing === r.id && (r.origin === 'profile' ? <PrivateRuleEdit key={r.id} rule={draft.overlay.extraRules!.find((e) => e.rule.id === r.id)!.rule}
              onApply={(value) => setExtra(r.id, () => value)} onClose={() => setEditing(undefined)} /> :
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
        {template && draft.overlay.final && <Button size="sm" variant="ghost" onClick={() => patchOverlay((o) => { const { final: _, ...rest } = o; return rest; })}>还原为模板</Button>}
      </div>
    </Card>
    <ExtraRuleModal open={adding} onClose={() => setAdding(false)} onAdd={(anchor, rule) => patchOverlay((o) => ({ ...o, extraRules: [...(o.extraRules ?? []), { anchor, rule }] }))} />
  </>;
}
