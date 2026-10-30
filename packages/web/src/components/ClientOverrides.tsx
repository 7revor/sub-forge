import type { ReactNode } from 'react';
import { rawRuleError, type ClientOverride, type Platform, type RuleIR } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { RuleEditor } from './RuleEditor.tsx';
import { rawRuleFromText } from './rule.ts';
import { SortableList } from './SortableList.tsx';
import { Button, FieldError, Field, Select, cx } from './ui.tsx';

export function ruleInputError(rule: RuleIR | undefined): string | undefined {
  if (!rule) return '请填写 RAW 规则。';
  if ('value' in rule) return rule.value.trim() ? undefined : '请填写规则值。';
  if (rule.type === 'RAW') return rawRuleError(rule.text);
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

export const newClientOverride = (): ClientOverride => ({ when: { client: 'mihomo' }, action: { replace: [rawRuleFromText('')] } });

export function ClientOverrides({ value, onChange, single = false, allowAppend = false, matchInput, leading, trailing }: {
  value: ClientOverride[]; onChange: (value: ClientOverride[]) => void; single?: boolean; allowAppend?: boolean; matchInput?: ReactNode;
  leading?: ReactNode; trailing?: ReactNode;
}) {
  const update = (index: number, override: ClientOverride) => onChange(value.map((item, i) => i === index ? override : item));
  const render = (override: ClientOverride, index: number) => {
    const action = 'append' in override.action ? 'append' : 'replace' in override.action ? 'replace' : 'drop';
    const replacements = 'append' in override.action ? override.action.append : 'replace' in override.action ? override.action.replace : undefined;
    const ruleLabel = action === 'append' ? '追加' : '替换';
    const setRules = (rules: RuleIR[]) => update(index, { ...override, action: action === 'append' ? { append: rules } : { replace: rules } });
    return <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-start gap-2">
        {leading && <div className="flex h-[62px] shrink-0 items-end pb-[3px]">{leading}</div>}
        <div className={cx('grid min-w-0 flex-1 grid-cols-2 items-start gap-3 sm:grid-cols-3', matchInput ? 'lg:grid-cols-[100px_112px_112px_minmax(0,1fr)]' : 'sm:max-w-[348px]')}>
          <Field label="改写类型" className="col-span-full sm:col-span-1">{(id) => <Select placeholder="选择替换、丢弃或追加规则" id={id} value={action} onChange={(event) => {
              const next = event.target.value;
              if (next === action) return;
              update(index, { ...override, action: next === 'drop' ? { drop: true } : next === 'append' ? { append: replacements ?? [rawRuleFromText('')] } : { replace: replacements ?? [rawRuleFromText('')] } });
            }}><option value="replace">替换</option><option value="drop">丢弃</option>{allowAppend && <option value="append">追加</option>}</Select>}</Field>
          <Field label="客户端">{(id) => <Select placeholder="选择这条改写适用的客户端" id={id} value={override.when.client} onChange={(e) => update(index, { ...override, when: { ...override.when, client: e.target.value as ClientOverride['when']['client'] } })}>
            <option value="mihomo">mihomo</option><option value="surge">Surge</option><option value="loon">Loon</option><option value="stash">Stash</option>
          </Select>}</Field>
          <Field label="平台">{(id) => <Select clearable aria-label="适用平台" placeholder="限定适用的系统平台，留空适用于所有平台" id={id} value={override.when.platform ?? ''} onChange={(e) => {
            const { platform: _, ...when } = override.when;
            update(index, { ...override, when: e.target.value ? { ...when, platform: e.target.value as Platform } : when });
          }}>{(['android', 'macos', 'windows', 'ios', 'linux'] as const).map((platform) => <option key={platform} value={platform}>{platform}</option>)}</Select>}</Field>
          {matchInput && <div className="col-span-full min-w-0 lg:col-span-1">{matchInput}</div>}
        </div>
        {!single && <Button size="sm" variant="ghost" className="mt-6" aria-label={`删除客户端覆盖 ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>}
        {trailing && <div className="ml-auto flex h-[62px] shrink-0 items-end pb-[3px]">{trailing}</div>}
      </div>
      {replacements && <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 pl-8">
          <span className="text-[12.5px] font-medium text-ink-muted">{action === 'append' ? '追加规则' : '替换为'}</span>
          <Button size="sm" variant="ghost" onClick={() => setRules([...replacements, rawRuleFromText('')])}><Plus size={14} />添加{ruleLabel}规则</Button>
        </div>
        <div className="flex flex-col gap-3 pl-8">
          {replacements.map((rule, i) => <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><RuleEditor value={rule}
              onChange={(next) => setRules(replacements.map((item, j) => j === i ? next : item))} /></div>
            <Button size="sm" variant="ghost" className="mt-[3px]" aria-label={`删除${ruleLabel}规则 ${i + 1}`} disabled={replacements.length === 1}
              onClick={() => setRules(replacements.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
          </div>)}
        </div>
      </div>}
    </div>;
  };
  return <div className="flex flex-col gap-3">
    {!single && <p className="m-0 text-[12.5px] text-ink-muted">命中第一条匹配的覆盖</p>}
    {single ? value.map((override, i) => <div key={i}>{render(override, i)}</div>) : <SortableList items={value} onReorder={onChange}
      renderItem={(override, i, handle) => <div className="my-2 flex items-start gap-2 rounded-lg border border-line p-3">{handle}{render(override, i)}</div>} />}
    {!single && <FieldError error={clientOverridesError(value)} />}
    {!single && <Button className="self-start" size="sm" onClick={() => onChange([...value, newClientOverride()])}><Plus size={14} />添加客户端覆盖</Button>}
  </div>;
}
