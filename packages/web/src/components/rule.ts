import type { RuleIR } from '@sub-forge/core';

const PROCESS_RULE_TYPES = {
  'PROCESS-NAME': { kind: 'name', mode: 'exact' },
  'PROCESS-PATH': { kind: 'path', mode: 'exact' },
  'PROCESS-NAME-WILDCARD': { kind: 'name', mode: 'wildcard' },
  'PROCESS-PATH-WILDCARD': { kind: 'path', mode: 'wildcard' },
  'PROCESS-NAME-REGEX': { kind: 'name', mode: 'regex' },
  'PROCESS-PATH-REGEX': { kind: 'path', mode: 'regex' },
} as const;
export type RuleTypeOption = RuleIR['type'] | keyof typeof PROCESS_RULE_TYPES;
const isProcessRuleType = (type: RuleTypeOption): type is keyof typeof PROCESS_RULE_TYPES => Object.hasOwn(PROCESS_RULE_TYPES, type);

export const RULE_TYPE_GROUPS = [
  { label: '域名', types: ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX'] },
  { label: 'IP', types: ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'SRC-IP-CIDR'] },
  { label: 'GEO', types: ['GEOSITE', 'GEOIP'] },
  { label: '端口', types: ['DST-PORT', 'SRC-PORT'] },
  { label: '网络', types: ['NETWORK'] },
  { label: '进程', types: ['PROCESS-NAME', 'PROCESS-PATH', 'PROCESS-NAME-WILDCARD', 'PROCESS-PATH-WILDCARD', 'PROCESS-NAME-REGEX', 'PROCESS-PATH-REGEX'] },
] as const;

export function ruleTypeValue(rule: RuleIR | undefined): RuleTypeOption | '' {
  if (rule?.type !== 'PROCESS') return rule?.type ?? '';
  return `PROCESS-${rule.kind === 'name' ? 'NAME' : 'PATH'}${rule.mode === 'exact' ? '' : `-${rule.mode.toUpperCase()}`}` as RuleTypeOption;
}

export function emptyRule(type: RuleTypeOption): RuleIR {
  if (isProcessRuleType(type)) return { type: 'PROCESS', ...PROCESS_RULE_TYPES[type], value: '' };
  switch (type) {
    case 'NETWORK': return { type, value: 'tcp' };
    case 'PROCESS': return { type, kind: 'name', mode: 'exact', value: '' };
    case 'AND': case 'OR': case 'NOT': return { type, children: [] };
    case 'RAW': return { type, client: 'mihomo', text: '' };
    default: return { type, value: '' };
  }
}

export function ruleToLine(rule: RuleIR): string {
  switch (rule.type) {
    case 'PROCESS': return `PROCESS-${rule.kind === 'name' ? 'NAME' : 'PATH'}${rule.mode === 'exact' ? '' : `-${rule.mode.toUpperCase()}`},${rule.value}`;
    case 'RAW': return rule.text;
    case 'AND': case 'OR': case 'NOT': return `${rule.type},(${rule.children.map((child) => `(${ruleToLine(child)})`).join(',')})`;
    default: return `${rule.type},${rule.value}${'noResolve' in rule && rule.noResolve ? ',no-resolve' : ''}${'src' in rule && rule.src ? ',src' : ''}`;
  }
}
