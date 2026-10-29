import type { RuleIR } from '@sub-forge/core';
import { rawRuleFromText, ruleToLine } from './rule.ts';
import { Field, Input } from './ui.tsx';

/** 三处共用 RAW 单行编辑；已有结构化规则仅在编辑后转成 RAW。 */
export function RuleEditor({ value, onChange }: {
  value: RuleIR | undefined; onChange: (rule: RuleIR) => void;
}) {
  return <Field label="RAW 规则" hint="填写完整匹配规则，不含出口；no-resolve、src 等选项直接写在末尾。">
    {(id) => <Input id={id} className="min-w-0 font-mono" spellCheck={false}
      placeholder="如 PROCESS-PATH-WILDCARD,/Applications/*"
      value={value ? ruleToLine(value) : ''}
      onChange={(event) => onChange(rawRuleFromText(event.target.value, value))} />}
  </Field>;
}
