import { parseRuleLine, type RuleIR } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { emptyRule, RULE_TYPE_GROUPS, ruleToLine, ruleTypeValue } from './rule.ts';

const rules: RuleIR[] = [
  { type: 'DOMAIN', value: 'example.com' },
  { type: 'DOMAIN-SUFFIX', value: 'example.com' },
  { type: 'DOMAIN-KEYWORD', value: 'example' },
  { type: 'DOMAIN-WILDCARD', value: '*.example.com' },
  { type: 'DOMAIN-REGEX', value: '^example\\.com$' },
  { type: 'IP-CIDR', value: '192.0.2.0/24' },
  { type: 'IP-CIDR6', value: '2001:db8::/32' },
  { type: 'IP-ASN', value: '64512' },
  { type: 'SRC-IP-CIDR', value: '192.0.2.0/24' },
  { type: 'GEOSITE', value: 'cn' },
  { type: 'GEOIP', value: 'cn' },
  { type: 'DST-PORT', value: '443' },
  { type: 'SRC-PORT', value: '1024-65535' },
  { type: 'NETWORK', value: 'tcp' },
  { type: 'NETWORK', value: 'udp' },
];
for (const kind of ['name', 'path'] as const) {
  for (const mode of ['exact', 'wildcard', 'regex'] as const) {
    rules.push({ type: 'PROCESS', kind, mode, value: kind === 'path' ? '/Applications/App/app' : 'app.exe' });
  }
}
for (const type of ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'] as const) {
  const rule = rules.find((rule) => rule.type === type)!;
  rules.push({ ...rule, noResolve: true } as RuleIR);
}

describe('规则文本', () => {
  it.each(rules)('往返 %#：$type', (rule) => {
    expect(parseRuleLine(ruleToLine(rule))).toEqual(rule);
  });
  it('进程规则输出 mihomo 类型', () => {
    expect(ruleToLine({ type: 'PROCESS', kind: 'name', mode: 'exact', value: 'app' })).toBe('PROCESS-NAME,app');
    expect(ruleToLine({ type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Apps/*' })).toBe('PROCESS-PATH-WILDCARD,/Apps/*');
    expect(ruleToLine({ type: 'PROCESS', kind: 'name', mode: 'regex', value: '^app' })).toBe('PROCESS-NAME-REGEX,^app');
  });
  // SRC-IP-CIDR 匹配源地址，不涉及 DNS 解析，内核不保留 no-resolve；表单也不提供该开关
  it('SRC-IP-CIDR 不带 no-resolve 往返', () => {
    const rule: RuleIR = { type: 'SRC-IP-CIDR', value: '192.0.2.0/24' };
    expect(parseRuleLine(ruleToLine(rule))).toEqual(rule);
  });
  it('每一种表单类型都有对应空规则', () => {
    for (const group of RULE_TYPE_GROUPS) {
      for (const type of group.types) expect(ruleTypeValue(emptyRule(type))).toBe(type);
    }
    expect(emptyRule('PROCESS')).toEqual({ type: 'PROCESS', kind: 'name', mode: 'exact', value: '' });
    expect(emptyRule('NETWORK')).toEqual({ type: 'NETWORK', value: 'tcp' });
  });
  it('进程的六种具体类型直接映射，已有语义化规则可回显', () => {
    expect(RULE_TYPE_GROUPS.find(group => group.label === '进程')!.types).toEqual([
      'PROCESS-NAME', 'PROCESS-PATH', 'PROCESS-NAME-WILDCARD', 'PROCESS-PATH-WILDCARD', 'PROCESS-NAME-REGEX', 'PROCESS-PATH-REGEX',
    ]);
    for (const rule of rules.filter(rule => rule.type === 'PROCESS')) {
      expect(emptyRule(ruleTypeValue(rule) as Parameters<typeof emptyRule>[0])).toEqual({ ...rule, value: '' });
    }
  });
  it('只读逻辑和 RAW 文本不丢内容', () => {
    expect(ruleToLine({ type: 'AND', children: [{ type: 'DOMAIN', value: 'a' }, { type: 'NETWORK', value: 'tcp' }] }))
      .toBe('AND,((DOMAIN,a),(NETWORK,tcp))');
    expect(ruleToLine({ type: 'RAW', client: 'mihomo', text: 'CUSTOM,x' })).toBe('CUSTOM,x');
  });
});
