// 规则：继承模板规则（可禁用、改出口，出口可改为已加入节点集中的单个节点），在锚点前后插入私有规则，改 MATCH 出口。

import { parseRuleLine, type Matcher, type RuleEntry, type RuleIR, type Target } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TargetPicker, targetLabel } from '../../components/pickers.tsx';
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Switch, cx, td, th } from '../../components/ui.tsx';
import { useList } from '../../hooks.ts';
import { useProfile } from './context.ts';

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

type Anchor = 'top' | 'bottom' | { before: string } | { after: string };

function ExtraRuleModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (anchor: Anchor, rule: RuleEntry) => void }) {
  const { template, groupOptions, profileNodeSets } = useProfile();
  const rulesets = useList('rulesets').data ?? [];
  const bundles = useList('bundles').data ?? [];
  const [kind, setKind] = useState<Matcher['kind']>('rule');
  const [line, setLine] = useState('');
  const [setId, setSetId] = useState('');
  const [anchor, setAnchor] = useState('top');
  const [target, setTarget] = useState<Target>({ kind: 'builtin', name: 'DIRECT' });
  let parsed: RuleIR | undefined;
  let parseError = '';
  if (kind === 'rule' && line.trim()) {
    try { parsed = parseRuleLine(line.trim()); } catch (e) { parseError = (e as Error).message; }
  }
  const options = kind === 'ruleset' ? rulesets.map((r) => ({ id: r.id, name: r.name })) : bundles.map((b) => ({ id: b.id, name: b.name }));
  const matcher: Matcher | undefined = kind === 'rule' ? (parsed ? { kind: 'rule', rule: parsed } : undefined) : (setId || options[0]?.id) ? { kind, id: setId || options[0]!.id } : undefined;

  const submit = () => {
    if (!matcher) return;
    const a: Anchor = anchor === 'top' || anchor === 'bottom' ? anchor : anchor.startsWith('before:') ? { before: anchor.slice(7) } : { after: anchor.slice(6) };
    onAdd(a, { id: `p_${Date.now().toString(36)}`, matcher, target, enabled: true });
    setLine('');
    onClose();
  };

  return (
    <Modal title="插入私有规则" open={open} onClose={onClose} wide footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher} onClick={submit}>插入</Button></>}>
      <Field label="位置">{(id) => (
        <Select id={id} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
          <option value="top">最前面</option>
          <option value="bottom">最后面（MATCH 之前）</option>
          {(template?.rules ?? []).map((r, i) => <option key={`b${r.id}`} value={`before:${r.id}`}>模板规则 #{i + 1} 之前</option>)}
          {(template?.rules ?? []).map((r, i) => <option key={`a${r.id}`} value={`after:${r.id}`}>模板规则 #{i + 1} 之后</option>)}
        </Select>
      )}</Field>
      <Field label="匹配项">{(id) => (
        <Select id={id} value={kind} onChange={(e) => { setKind(e.target.value as Matcher['kind']); setSetId(''); }}>
          <option value="rule">单条规则</option><option value="ruleset">规则集</option><option value="bundle">规则包</option>
        </Select>
      )}</Field>
      {kind === 'rule' ? (
        <Field label="规则（不含出口）" hint={parseError ? <span className="text-err">{parseError}</span> : parsed ? `解析为：${ruleText(parsed)}` : '如 DOMAIN-SUFFIX,example.com 或 PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*'}>
          {(id) => <Input id={id} className="font-mono" value={line} onChange={(e) => setLine(e.target.value)} />}
        </Field>
      ) : (
        <Field label={kind === 'ruleset' ? '规则集' : '规则包'}>{(id) => (
          <Select id={id} value={setId || options[0]?.id || ''} onChange={(e) => setSetId(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        )}</Field>
      )}
      <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">出口</span>
        <TargetPicker label="出口" value={target} onChange={setTarget} groups={groupOptions} nodeSets={profileNodeSets} /></div>
    </Modal>
  );
}

export function TabRules() {
  const { draft, template, patchOverlay, groupOptions, groupName, profileNodeSets, nodeSetName } = useProfile();
  const label = useMatcherLabel();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const patches = draft.overlay.rulePatches ?? {};
  const orphans = Object.keys(patches).filter((id) => !template?.rules.some((r) => r.id === id));

  // 合并后的顺序（与内核一致），私有规则可删除
  type Row = RuleEntry & { origin: 'template' | 'profile' };
  const rows: Row[] = (template?.rules ?? []).map((r) => ({ ...r, origin: 'template' as const, ...(patches[r.id]?.enabled !== undefined ? { enabled: patches[r.id]!.enabled } : {}), ...(patches[r.id]?.target ? { target: patches[r.id]!.target! } : {}) }));
  for (const { anchor, rule } of draft.overlay.extraRules ?? []) {
    const r: Row = { ...rule, origin: 'profile' };
    if (anchor === 'top') rows.unshift(r);
    else if (anchor === 'bottom') rows.push(r);
    else {
      const id = 'before' in anchor ? anchor.before : anchor.after;
      const at = rows.findIndex((x) => x.id === id);
      if (at >= 0) rows.splice('before' in anchor ? at : at + 1, 0, r);
    }
  }
  const final = draft.overlay.final ?? template?.final ?? { kind: 'builtin' as const, name: 'DIRECT' as const };

  const patchRule = (id: string, p: { enabled?: boolean; target?: Target }) => patchOverlay((o) => ({ ...o, rulePatches: { ...o.rulePatches, [id]: { ...(o.rulePatches?.[id] ?? {}), ...p } } }));
  const setExtra = (id: string, fn: (r: RuleEntry) => RuleEntry | undefined) => patchOverlay((o) => ({
    ...o,
    extraRules: (o.extraRules ?? []).flatMap((e) => { if (e.rule.id !== id) return [e]; const r = fn(e.rule); return r ? [{ ...e, rule: r }] : []; }),
  }));

  return (
    <>
      {orphans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-4 py-3 text-[#6b3406]">
          <span className="text-[13px]"><b>{orphans.length} 个孤儿覆盖项不再输出：</b>模板已删除对应的规则。</span>
          <Button size="sm" onClick={() => patchOverlay((o) => ({ ...o, rulePatches: Object.fromEntries(Object.entries(o.rulePatches ?? {}).filter(([id]) => !orphans.includes(id))) }))}>清理</Button>
        </div>
      )}
      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">规则（自上而下匹配）</h2><span className="text-[12.5px] text-muted">继承自模板 · 可禁用、改出口为已加入的节点、在锚点前后插入私有规则</span></div>}
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} />插入私有规则</Button>} bodyClass="overflow-x-auto">
        {!rows.length ? <div className="px-4 pb-4"><Empty>没有规则，所有流量走 MATCH。</Empty></div> : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr><th className={th}>#</th><th className={th}>匹配项</th><th className={th}>出口</th><th className={th}>来源</th><th className={th}>启用</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const l = label(r.matcher);
                const overridden = r.origin === 'template' && patches[r.id]?.target;
                const off = r.enabled === false;
                return (
                  <tr key={r.id} className={off ? 'bg-[#fafafb]' : ''}>
                    <td className={`${td} font-mono text-muted`}>{i + 1}</td>
                    <td className={td}><span className="flex flex-wrap items-center gap-2"><Badge>{l.kind}</Badge><span className={cx('font-mono text-[13px]', off && 'line-through')}>{l.text}</span></span></td>
                    <td className={td}>
                      {editing === r.id ? (
                        <div className="flex flex-col gap-2">
                          <TargetPicker label="出口" value={r.target} groups={groupOptions} nodeSets={profileNodeSets}
                            onChange={(t) => (r.origin === 'template' ? patchRule(r.id, { target: t }) : setExtra(r.id, (x) => ({ ...x, target: t })))} />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => setEditing(undefined)}>完成</Button>
                            {overridden && <Button size="sm" variant="ghost" onClick={() => { patchOverlay((o) => { const { target: _t, ...rest } = o.rulePatches?.[r.id] ?? {}; return { ...o, rulePatches: { ...o.rulePatches, [r.id]: rest } }; }); setEditing(undefined); }}>还原为模板出口</Button>}
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="cursor-pointer text-left font-medium hover:text-accent" onClick={() => setEditing(r.id)}>
                          {targetLabel(r.target, groupName, nodeSetName)}{overridden && <span className="ml-2 text-[12px] font-normal text-accent">已改出口</span>}
                        </button>
                      )}
                    </td>
                    <td className={td}>{r.origin === 'template' ? <Badge>{off && patches[r.id]?.enabled === false ? '模板 · 已禁用' : overridden ? '覆盖' : '模板'}</Badge> : <Badge tone="ok">私有</Badge>}</td>
                    <td className={td}>
                      {r.origin === 'template'
                        ? <Switch label={`启用规则 ${i + 1}`} checked={!off} onChange={(v) => patchRule(r.id, { enabled: v })} />
                        : <Button size="sm" variant="ghost" aria-label={`删除私有规则 ${i + 1}`} onClick={() => setExtra(r.id, () => undefined)}><Trash2 size={14} /></Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <span className="font-mono text-[13px]">MATCH</span>
          <TargetPicker label="MATCH 出口" value={final} groups={groupOptions} nodeSets={profileNodeSets} onChange={(t) => patchOverlay((o) => ({ ...o, final: t }))} />
          {draft.overlay.final && <Button size="sm" variant="ghost" onClick={() => patchOverlay((o) => { const { final: _f, ...rest } = o; return rest; })}>还原为模板</Button>}
        </div>
      </Card>
      <ExtraRuleModal open={adding} onClose={() => setAdding(false)} onAdd={(anchor, rule) => patchOverlay((o) => ({ ...o, extraRules: [...(o.extraRules ?? []), { anchor, rule }] }))} />
    </>
  );
}
