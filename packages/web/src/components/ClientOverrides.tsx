import type { ReactNode } from 'react';
import type { ClientOverride, Platform, RuleIR } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { RuleEditor } from './RuleEditor.tsx';
import { emptyRule } from './rule.ts';
import { SortableList } from './SortableList.tsx';
import { Button, FieldError, Field, Segmented, Select } from './ui.tsx';

export function ruleInputError(rule: RuleIR | undefined): string | undefined {
  if (!rule) return '请选择规则类型并填写规则值。';
  if ('value' in rule) return rule.value.trim() ? undefined : '请填写规则值。';
  if (rule.type === 'RAW') return rule.text.trim() ? undefined : '请填写原样规则。';
  return !rule.children.length || rule.children.some((child) => ruleInputError(child)) ? '请填写完整的逻辑规则。' : undefined;
}

export function clientOverridesError(overrides: ClientOverride[]): string | undefined {
  for (const [i, override] of overrides.entries()) {
    const rules = 'replace' in override.action ? override.action.replace : 'append' in override.action ? override.action.append : undefined;
    if (rules && (!rules.length || rules.some((rule) => ruleInputError(rule)))) {
      return `客户端覆盖第 ${i + 1} 条：请填写至少一条完整的${'append' in override.action ? '追加' : '替换'}规则。`;
    }
  }
  return undefined;
}

export const newClientOverride = (): ClientOverride => ({ when: { client: 'mihomo' }, action: { replace: [emptyRule('DOMAIN')] } });

export function ClientOverrides({ value, onChange, single = false, allowAppend = false, matchInput }: {
  value: ClientOverride[]; onChange: (value: ClientOverride[]) => void; single?: boolean; allowAppend?: boolean; matchInput?: ReactNode;
}) {
  const update = (index: number, override: ClientOverride) => onChange(value.map((item, i) => i === index ? override : item));
  const render = (override: ClientOverride, index: number) => {
    const action = 'append' in override.action ? 'append' : 'replace' in override.action ? 'replace' : 'drop';
    const replacements = 'append' in override.action ? override.action.append : 'replace' in override.action ? override.action.replace : undefined;
    const ruleLabel = action === 'append' ? '追加' : '替换';
    const setRules = (rules: RuleIR[]) => update(index, { ...override, action: action === 'append' ? { append: rules } : { replace: rules } });
    return <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented label="改写方式" value={action} options={[{ value: 'replace', label: '替换' }, { value: 'drop', label: '丢弃' }, ...(allowAppend ? [{ value: 'append', label: '追加' }] : [])]}
          onChange={(next) => {
            if (next === action) return;
            update(index, { ...override, action: next === 'drop' ? { drop: true } : next === 'append' ? { append: replacements ?? [emptyRule('DOMAIN')] } : { replace: replacements ?? [emptyRule('DOMAIN')] } });
          }} />

        <Field label="客户端">{(id) => <Select id={id} value={override.when.client} onChange={(e) => update(index, { ...override, when: { ...override.when, client: e.target.value as ClientOverride['when']['client'] } })}>
          <option value="mihomo">mihomo</option><option value="surge">Surge</option>
        </Select>}</Field>
        <Field label="平台">{(id) => <Select id={id} value={override.when.platform ?? ''} onChange={(e) => {
          const { platform: _, ...when } = override.when;
          update(index, { ...override, when: e.target.value ? { ...when, platform: e.target.value as Platform } : when });
        }}><option value="">不限</option>{(['android', 'macos', 'windows', 'ios', 'linux'] as const).map((platform) => <option key={platform} value={platform}>{platform}</option>)}</Select>}</Field>
        {!single && <Button size="sm" variant="ghost" aria-label={`删除客户端覆盖 ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>}
      </div>
      {matchInput}
      {replacements && <>
        <SortableList items={replacements} onReorder={setRules}
          renderItem={(rule, i, handle) => <div className="my-2 flex items-start gap-2 rounded-lg border border-line-2 p-3">
            {handle}<div className="min-w-0 flex-1"><RuleEditor value={rule}
              onChange={(next) => setRules(replacements.map((item, j) => j === i ? next : item))}
              onIncomplete={(next) => setRules(replacements.map((item, j) => j === i ? next : item))} /></div>
            <Button size="sm" variant="ghost" aria-label={`删除${ruleLabel}规则 ${i + 1}`} disabled={replacements.length === 1}
              onClick={() => setRules(replacements.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
          </div>} />
        <Button size="sm" className="self-start" onClick={() => setRules([...replacements, emptyRule('DOMAIN')])}><Plus size={14} />添加{ruleLabel}规则</Button>
      </>}
    </div>;
  };
  return <div className="flex flex-col gap-3">
    {!single && <p className="m-0 text-[12.5px] text-muted">命中第一条匹配的覆盖</p>}
    {single ? value.map((override, i) => <div key={i}>{render(override, i)}</div>) : <SortableList items={value} onReorder={onChange}
      renderItem={(override, i, handle) => <div className="my-2 flex items-start gap-2 rounded-lg border border-line p-3">{handle}{render(override, i)}</div>} />}
    <FieldError error={clientOverridesError(value)} />
    {!single && <Button className="self-start" size="sm" onClick={() => onChange([...value, newClientOverride()])}><Plus size={14} />添加客户端覆盖</Button>}
  </div>;
}
