import type { RuleIR } from '@sub-forge/core';
import { rawRuleFromText, ruleToLine } from './rule.ts';
import { Input } from './ui.tsx';

/** 三处共用 RAW 单行编辑；已有结构化规则仅在编辑后转成 RAW。 */
export function RuleEditor({ value, onChange }: {
  value: RuleIR | undefined; onChange: (rule: RuleIR) => void;
}) {
  return <Input aria-label="规则内容" className="min-w-0 font-mono" spellCheck={false}
    placeholder="如 PROCESS-PATH-WILDCARD,/Applications/*"
    value={value ? ruleToLine(value) : ''}
    onChange={(event) => onChange(rawRuleFromText(event.target.value, value))} />;
}
