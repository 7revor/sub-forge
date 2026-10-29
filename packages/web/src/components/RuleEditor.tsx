import { alertError, notifySuccess } from '../feedback.ts';
import { parseRuleLine, type RuleIR } from '@sub-forge/core';
import { useState } from 'react';
import { emptyRule, RULE_TYPE_GROUPS, ruleToLine, ruleTypeValue, type RuleTypeOption } from './rule.ts';
import { Button, Field, Input, Select, Switch } from './ui.tsx';

export function RuleEditor({ value, onChange, onIncomplete, compact = false }: {
  value: RuleIR | undefined; onChange: (rule: RuleIR) => void;
  compact?: boolean;
  /** 可选地把未填完的规则交给父级草稿，防止清空后仍保存旧值。 */
  onIncomplete?: (rule: RuleIR) => void;
}) {
  const [draft, setDraft] = useState<{ source: RuleIR | undefined; rule: RuleIR }>();
  const [line, setLine] = useState('');
  const rule = draft && draft.source === value ? draft.rule : value;
  const edit = (next: RuleIR) => {
    const filled = 'value' in next && next.value.trim() !== '';
    setDraft({ source: filled || onIncomplete ? next : value, rule: next });
    if (filled) onChange(next);
    else onIncomplete?.(next);
  };
  const readonly = rule && (rule.type === 'RAW' || rule.type === 'AND' || rule.type === 'OR' || rule.type === 'NOT');
  const pasteInput = <Field label="粘贴整行" hint="classical 规则，不含出口">{(id) => <div className="flex gap-2">
    <Input id={id} className="min-w-0 font-mono" value={line} onChange={(e) => setLine(e.target.value)} />
    <Button onClick={() => {
      try {
        const parsed = parseRuleLine(line);
        setDraft(undefined); onChange(parsed); notifySuccess('规则已解析');
      } catch (error) { alertError(error); }
    }}>解析</Button>
  </div>}</Field>;
  return <div className={compact ? 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]' : 'flex flex-col gap-3'}>
    <Field label="规则类型">{(id) => <Select id={id} value={ruleTypeValue(rule)} onChange={(e) => {
      if (!e.target.value) return;
      const next = emptyRule(e.target.value as RuleTypeOption);
      edit(rule?.type === 'PROCESS' && next.type === 'PROCESS' ? { ...next, value: rule.value } : next);
    }}>
      <option value="">请选择类型</option>
      {RULE_TYPE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.types.map((type) => <option key={type} value={type}>{type}</option>)}</optgroup>)}
      {readonly && <option value={rule.type}>{rule.type}</option>}
    </Select>}</Field>
    {readonly ? <div className="min-w-0 rounded-lg bg-ground p-3 text-[13px]">
      <pre className="m-0 whitespace-pre-wrap break-all font-mono">{ruleToLine(rule)}</pre>
      <p className="mb-0 text-muted">{compact ? '保留原有规则；选择其他类型可重新编辑。' : '请用粘贴整行编辑'}</p>
    </div> : rule && 'value' in rule && <>
      <Field label="规则值" className={compact ? 'sm:col-start-2 sm:row-start-1' : undefined}>{(id) => rule.type === 'NETWORK'
        ? <Select id={id} value={rule.value} onChange={(e) => edit({ ...rule, value: e.target.value as 'tcp' | 'udp' })}><option value="tcp">tcp</option><option value="udp">udp</option></Select>
        : <Input id={id} className="font-mono" value={rule.value} onChange={(e) => edit({ ...rule, value: e.target.value })} />}</Field>
      {(['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'] as string[]).includes(rule.type) && <div className="col-span-full flex items-center gap-2">
        <Switch label="no-resolve" checked={'noResolve' in rule && rule.noResolve === true} onChange={(checked) => {
          if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6' || rule.type === 'IP-ASN' || rule.type === 'GEOIP') {
            const { noResolve: _, ...rest } = rule;
            edit(checked ? { ...rest, noResolve: true } : rest);
          }
        }} /><span className="text-[13px]">no-resolve</span>
      </div>}
    </>}
    {!compact && pasteInput}
  </div>;
}
