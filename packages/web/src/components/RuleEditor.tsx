import { parseRuleLine, type RuleIR } from '@sub-forge/core';
import { useState } from 'react';
import { emptyRule, RULE_TYPE_GROUPS, ruleToLine } from './rule.ts';
import { Button, ErrorBox, Field, Input, Segmented, Select, Switch } from './ui.tsx';

export function RuleEditor({ value, onChange, onIncomplete }: {
  value: RuleIR | undefined; onChange: (rule: RuleIR) => void;
  /** 可选地把未填完的规则交给父级草稿，防止清空后仍保存旧值。 */
  onIncomplete?: (rule: RuleIR) => void;
}) {
  const [draft, setDraft] = useState<{ source: RuleIR | undefined; rule: RuleIR }>();
  const [line, setLine] = useState('');
  const [error, setError] = useState('');
  const rule = draft && draft.source === value ? draft.rule : value;
  const edit = (next: RuleIR) => {
    const filled = 'value' in next && next.value.trim() !== '';
    setDraft({ source: filled || onIncomplete ? next : value, rule: next });
    if (filled) onChange(next);
    else onIncomplete?.(next);
  };
  const readonly = rule && (rule.type === 'RAW' || rule.type === 'AND' || rule.type === 'OR' || rule.type === 'NOT');
  return <div className="flex flex-col gap-3">
    <Field label="规则类型">{(id) => <Select id={id} value={rule?.type ?? ''} onChange={(e) => { if (e.target.value) edit(emptyRule(e.target.value as RuleIR['type'])); }}>
      <option value="">请选择类型</option>
      {RULE_TYPE_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.types.map((type) => <option key={type} value={type}>{type}</option>)}</optgroup>)}
      {readonly && <option value={rule.type}>{rule.type}</option>}
    </Select>}</Field>
    {readonly ? <div className="rounded-lg bg-ground p-3 text-[13px]">
      <pre className="m-0 whitespace-pre-wrap break-all font-mono">{ruleToLine(rule)}</pre>
      <p className="mb-0 text-muted">请用粘贴整行编辑</p>
    </div> : rule && 'value' in rule && <>
      {rule.type === 'PROCESS' && <div className="flex flex-wrap gap-2">
        <Segmented label="进程匹配字段" value={rule.kind} options={[{ value: 'name', label: '名称' }, { value: 'path', label: '路径' }]} onChange={(kind) => edit({ ...rule, kind })} />
        <Segmented label="进程匹配方式" value={rule.mode} options={[{ value: 'exact', label: '精确' }, { value: 'wildcard', label: '通配' }, { value: 'regex', label: '正则' }]} onChange={(mode) => edit({ ...rule, mode })} />
      </div>}
      <Field label="规则值">{(id) => rule.type === 'NETWORK'
        ? <Select id={id} value={rule.value} onChange={(e) => edit({ ...rule, value: e.target.value as 'tcp' | 'udp' })}><option value="tcp">tcp</option><option value="udp">udp</option></Select>
        : <Input id={id} className="font-mono" value={rule.value} onChange={(e) => edit({ ...rule, value: e.target.value })} />}</Field>
      {(['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'] as string[]).includes(rule.type) && <div className="flex items-center gap-2">
        <Switch label="no-resolve" checked={'noResolve' in rule && rule.noResolve === true} onChange={(checked) => {
          if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6' || rule.type === 'IP-ASN' || rule.type === 'GEOIP') {
            const { noResolve: _, ...rest } = rule;
            edit(checked ? { ...rest, noResolve: true } : rest);
          }
        }} /><span className="text-[13px]">no-resolve</span>
      </div>}
    </>}
    <Field label="粘贴整行" hint="classical 规则，不含出口">{(id) => <div className="flex gap-2">
      <Input id={id} className="font-mono" value={line} onChange={(e) => { setLine(e.target.value); setError(''); }} />
      <Button onClick={() => {
        try {
          const parsed = parseRuleLine(line);
          setDraft(undefined); onChange(parsed); setError('');
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      }}>解析</Button>
    </div>}</Field>
    <ErrorBox error={error} />
  </div>;
}
