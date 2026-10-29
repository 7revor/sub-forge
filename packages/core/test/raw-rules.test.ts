import { describe, expect, it } from 'vitest';
import { composeRule, lowerRule, withIpOptions } from '../src/rules/client.ts';
import { rawRuleError } from '../src/rules/raw.ts';
import { convertRuleDocuments, prepareRuleDocument } from '../src/rules/convert.ts';
import { ruleKey } from '../src/rules/parse.ts';
import { validateTemplate } from '../src/template/validate.ts';
import type { RuleIR, RuleSet } from '../src/types.ts';

const raw = (text: string): RuleIR => ({ type: 'RAW', text });

describe('单条 RAW 规则', () => {
  it('通用 RAW 不限制类型与逻辑语法，旧 RAW 保留客户端约束', () => {
    for (const text of ['IN-TYPE,SOCKS/HTTP', 'AND,((DOMAIN,a.test),(NETWORK,tcp))', 'FUTURE,a,b,c']) {
      for (const client of ['mihomo', 'surge'] as const) expect(lowerRule(raw(text), { client })).toEqual({ kind: 'ok', text });
    }
    expect(lowerRule({ type: 'RAW', client: 'surge', text: 'USER-AGENT,x*' }, { client: 'mihomo' })).toMatchObject({ kind: 'drop' });
  });
  it('出口插入末尾选项前，旧选项合并后不重复', () => {
    const rule = withIpOptions(raw('IP-SUFFIX,8.8.8.8/24,src,no-resolve'), { noResolve: true, src: true });
    const lowered = lowerRule(rule, { client: 'mihomo' });
    expect(lowered).toEqual({ kind: 'ok', text: 'IP-SUFFIX,8.8.8.8/24', noResolve: true, src: true });
    if (lowered.kind === 'ok') expect(composeRule(lowered, 'DIRECT')).toBe('IP-SUFFIX,8.8.8.8/24,DIRECT,no-resolve,src');
  });
  it('RAW 与已有进程 wildcard 共用 mihomo 去重键，Surge 保留大小写差异', () => {
    const structured: RuleIR = { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Apps/*' };
    expect(ruleKey(raw('PROCESS-PATH-WILDCARD,/apps/*'), 'mihomo')).toBe(ruleKey(structured, 'mihomo'));
    expect(ruleKey(raw('DOMAIN-WILDCARD,*.Example.test'), 'mihomo')).toBe(ruleKey({ type: 'DOMAIN-WILDCARD', value: '*.example.test' }, 'mihomo'));
    expect(ruleKey(raw('PROCESS-PATH-WILDCARD,/Apps/*'), 'surge')).not.toBe(ruleKey(raw('PROCESS-PATH-WILDCARD,/apps/*'), 'surge'));
    const source = { id: 's', kind: 'local' as const, format: 'auto' as const, content: 'PROCESS-PATH-WILDCARD,/Apps/*' };
    const rs: RuleSet = { id: 'r', name: '', sources: [source], overrides: [{ override: { when: { client: 'mihomo' }, action: { append: [raw('PROCESS-PATH-WILDCARD,/apps/*')] } } }] };
    const out = convertRuleDocuments(rs, new Map([['s', prepareRuleDocument(source.content, source)]]), { client: 'mihomo' });
    expect(out.stats).toMatchObject({ duplicates: 1, output: 1, appended: 1 });
  });
  it('空值和换行不可作为单条 RAW 保存、发布或输出', () => {
    for (const text of ['', '  ', 'DOMAIN,a.test\nDOMAIN,b.test', 'DOMAIN,a.test\u2028DOMAIN,b.test']) {
      expect(rawRuleError(text)).toBeTruthy();
      expect(lowerRule(raw(text), { client: 'mihomo' }).kind).toBe('drop');
      expect(lowerRule(withIpOptions(raw(text), { noResolve: true, src: true }), { client: 'mihomo' }).kind).toBe('drop');
      const report = validateTemplate({ id: 't', version: 1, groups: [], rules: [{ id: 'r', matcher: { kind: 'rule', rule: raw(text) }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' } });
      expect(report.items).toContainEqual(expect.objectContaining({ code: 'template.invalid-raw-rule', where: 'rule:r' }));
    }
  });
});
