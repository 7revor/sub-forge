import type { RuleIR } from '@sub-forge/core';

export const RULE_TYPE_GROUPS = [
  { label: '域名', types: ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX'] },
  { label: 'IP', types: ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'SRC-IP-CIDR'] },
  { label: 'GEO', types: ['GEOSITE', 'GEOIP'] },
  { label: '端口', types: ['DST-PORT', 'SRC-PORT'] },
  { label: '网络', types: ['NETWORK'] },
  { label: '进程', types: ['PROCESS'] },
] as const;

export function emptyRule(type: RuleIR['type']): RuleIR {
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
    default: return `${rule.type},${rule.value}${'noResolve' in rule && rule.noResolve ? ',no-resolve' : ''}`;
  }
}
