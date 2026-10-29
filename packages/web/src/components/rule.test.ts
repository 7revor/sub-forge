import { parseRuleLine, type RuleIR } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { rawRuleFromText, ruleToLine } from './rule.ts';

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
  it('直接保留 RAW 规则文本，不受已有规则类型枚举限制', () => {
    for (const text of ['', 'IN-TYPE,SOCKS/HTTP', 'AND,((DOMAIN,a),(NETWORK,tcp))', 'IP-SUFFIX,8.8.8.8/24,no-resolve']) {
      expect(rawRuleFromText(text)).toEqual({ type: 'RAW', text });
    }
  });
  it('已有结构化规则回显完整文本，编辑后转成通用 RAW', () => {
    const previous: RuleIR = { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Apps/*' };
    expect(rawRuleFromText(ruleToLine(previous), previous)).toEqual({ type: 'RAW', text: 'PROCESS-PATH-WILDCARD,/Apps/*' });
  });
  it('旧 RAW 仍保留其客户端限制', () => {
    expect(rawRuleFromText('USER-AGENT,x*', { type: 'RAW', client: 'surge', text: 'USER-AGENT,old*' }))
      .toEqual({ type: 'RAW', client: 'surge', text: 'USER-AGENT,x*' });
  });
  it('只读逻辑和 RAW 文本不丢内容', () => {
    expect(ruleToLine({ type: 'AND', children: [{ type: 'DOMAIN', value: 'a' }, { type: 'NETWORK', value: 'tcp' }] }))
      .toBe('AND,((DOMAIN,a),(NETWORK,tcp))');
    expect(ruleToLine({ type: 'RAW', client: 'mihomo', text: 'CUSTOM,x' })).toBe('CUSTOM,x');
  });
});
