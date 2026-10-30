import type { RuleIR } from '@sub-forge/core';

/** 新规则默认不绑定客户端；旧 RAW 的客户端限制在编辑时继续保留。 */
export function rawRuleFromText(text: string, previous?: RuleIR): RuleIR {
  return { type: 'RAW', text, ...(previous?.type === 'RAW' && previous.client ? { client: previous.client } : {}) };
}

export function ruleToLine(rule: RuleIR): string {
  if (rule.extendedMatching) return `${ruleToLine({ ...rule, extendedMatching: false })},extended-matching`;
  switch (rule.type) {
    case 'PROCESS': return `PROCESS-${rule.kind === 'name' ? 'NAME' : 'PATH'}${rule.mode === 'exact' ? '' : `-${rule.mode.toUpperCase()}`},${rule.value}`;
    case 'RAW': return rule.text;
    case 'AND': case 'OR': case 'NOT': return `${rule.type},(${rule.children.map((child) => `(${ruleToLine(child)})`).join(',')})`;
    default: return `${rule.type},${rule.value}${'noResolve' in rule && rule.noResolve ? ',no-resolve' : ''}${'src' in rule && rule.src ? ',src' : ''}`;
  }
}
