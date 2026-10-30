import { describe, expect, it } from 'vitest';
import { parseRuleLine, ruleKey } from '../src/rules/parse.ts';
import { composeRule, lowerRule } from '../src/rules/client.ts';
import { rawRuleParts } from '../src/rules/raw.ts';
import { formatRuleLine } from '../src/rules/expand.ts';
import { regexToWildcard } from '../src/rules/client.ts';

describe('规则跨客户端转换保留语义', () => {
  it('相同网段的解析选项和源地址选项不能被去重合并', () => {
    const lines = ['IP-CIDR,192.0.2.0/24', 'IP-CIDR,192.0.2.0/24,no-resolve', 'IP-CIDR,192.0.2.0/24,src', 'IP-CIDR,192.0.2.0/24,no-resolve,src'];
    expect(new Set(lines.map(line => ruleKey(parseRuleLine(line)))).size).toBe(4);
  });
  it.each(['URL-REGEX,^https://example[.]test', 'DOMAIN,example.test,extended-matching', 'AND,((DOMAIN,example.test),(USER-AGENT,Example*))'])('编辑格式化不会把已支持规则变成注释：%s', line => {
    expect(formatRuleLine(parseRuleLine(line))).toBe(line);
  });
  it('转义后的字面量不能扩大成通配符，结构化规则不能注入换行', () => {
    expect(regexToWildcard('^Example\\*.*$')).toBeUndefined();
    expect(lowerRule({ type: 'DOMAIN', value: 'example.test\nFINAL,DIRECT' }, { client: 'surge' }).kind).toBe('drop');
  });
  it('保留 Surge 扩展匹配，出口在选项之前，且去重不混淆普通规则', () => {
    const rule = parseRuleLine('DOMAIN,example.com,extended-matching');
    const output = lowerRule(rule, { client: 'surge' });
    expect(output.kind).toBe('ok');
    if (output.kind === 'ok') expect(composeRule(output, '代理')).toBe('DOMAIN,example.com,代理,extended-matching');
    expect(ruleKey(rule)).not.toBe(ruleKey(parseRuleLine('DOMAIN,example.com')));
    expect(lowerRule(rule, { client: 'mihomo' }).kind).toBe('drop');
    expect(composeRule(rawRuleParts('DOMAIN,example.com,extended-matching'), '代理')).toBe('DOMAIN,example.com,代理,extended-matching');
  });
  it('递归转换逻辑子规则，并保留子规则选项', () => {
    const rule = parseRuleLine('AND,((DOMAIN-SUFFIX,example.com),(OR,((DST-PORT,443),(IP-CIDR,192.0.2.0/24,no-resolve))))');
    const output = lowerRule(rule, { client: 'surge' });
    expect(output).toMatchObject({ kind: 'ok', text: 'AND,((DOMAIN-SUFFIX,example.com),(OR,((DEST-PORT,443),(IP-CIDR,192.0.2.0/24,no-resolve))))' });
  });
  it('不通过删除不支持的子条件来放宽匹配', () => {
    const rule = parseRuleLine('AND,((DOMAIN,a.test),(USER-AGENT,Example*))');
    expect(lowerRule(rule, { client: 'mihomo' })).toMatchObject({ kind: 'drop' });
    expect(lowerRule(rule, { client: 'surge' }).kind).toBe('ok');
  });
  it('带逗号的 URL 正则保留引号和反斜杠', () => {
    const rule = parseRuleLine('URL-REGEX,"^https://example[.]com/a,b",extended-matching');
    expect(lowerRule(rule, { client: 'surge' })).toMatchObject({ kind: 'ok', text: 'URL-REGEX,"^https://example[.]com/a,b"', extendedMatching: true });
    expect(lowerRule(rule, { client: 'mihomo' }).kind).toBe('drop');
  });
  it.each(['NOT,((DOMAIN,a),(DOMAIN,b))', 'AND,(DOMAIN,a)', 'AND,((DOMAIN,a)', 'DOMAIN,a,unknown-option', 'DOMAIN,a,no-resolve'])('拒绝畸形或不能保留选项的规则：%s', line => {
    expect(() => parseRuleLine(line)).toThrow();
  });
});
