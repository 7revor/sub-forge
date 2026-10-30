import { describe, expect, it } from 'vitest';
import { renderMihomo } from '../src/render/mihomo.ts';
import { composeRule, lowerRule } from '../src/rules/client.ts';
import { parseRuleLine } from '../src/rules/parse.ts';
import type { RuleEntry } from '../src/types.ts';

const to = { kind: 'builtin' as const, name: 'DIRECT' as const };
const render = (content: string, entries: RuleEntry[] = [{ id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: to }]) => renderMihomo({
  profile: { id: 'p', name: 'P', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: entries.map(rule => ({ anchor: 'bottom', rule })) } },
  nodeSets: { sources: {}, collections: {}, locals: {}, snapshots: {} },
  rules: { rulesets: { rs: { id: 'rs', name: 'R', sources: [{ id: 's1', kind: 'local', format: 'classical', content }] } }, snapshots: {} },
  urls: { provider: k => `https://test/p/${k}`, ruleset: k => `https://test/r/${k}` },
});

describe('规则选项在解析与最终输出之间保真', () => {
  it('IP 原始规则同时保留 no-resolve 与 src', () => {
    const rule = parseRuleLine('IP-CIDR,192.0.2.0/24,no-resolve,src');
    expect(rule).toEqual({ type: 'IP-CIDR', value: '192.0.2.0/24', noResolve: true, src: true });
    const lowered = lowerRule(rule, { client: 'mihomo' });
    if (lowered.kind === 'drop') throw new Error(lowered.reason);
    expect(composeRule(lowered, 'DIRECT')).toBe('IP-CIDR,192.0.2.0/24,DIRECT,no-resolve,src');
    expect(lowerRule(rule, { client: 'surge' })).toMatchObject({ kind: 'ok', text: 'SRC-IP,192.0.2.0/24' });
  });

  it('规则集 CIDR 上的 no-resolve 保留在 classical 行内', () => {
    const r = render('IP-CIDR,192.0.2.0/24,no-resolve');
    expect(r.config.rules).toEqual(['RULE-SET,R,DIRECT', 'MATCH,DIRECT']);
    expect(r.rulesets['rs_rs_classical.list']!.text).toBe('IP-CIDR,192.0.2.0/24,no-resolve\n');
  });

  it('混合选项逐行输出，不把需要解析的规则一起禁止解析', () => {
    const r = render('IP-CIDR,192.0.2.0/24,no-resolve\nIP-CIDR,198.51.100.0/24\nIP-CIDR,203.0.113.0/24,no-resolve,src');
    expect(r.config.rules).toEqual(['RULE-SET,R,DIRECT', 'MATCH,DIRECT']);
    expect(Object.values(r.rulesets).map(x => x.text)).toEqual(['IP-CIDR,192.0.2.0/24,no-resolve\nIP-CIDR,198.51.100.0/24\nIP-CIDR,203.0.113.0/24,no-resolve,src\n']);
  });

  it('src 继续生效，旧 no-resolve 不再改变来源内容', () => {
    const plain: RuleEntry = { id: 'plain', matcher: { kind: 'ruleset', id: 'rs' }, target: to };
    const r = render('DOMAIN,example.test\nGEOIP,CN\nIP-CIDR,192.0.2.0/24', [plain, { ...plain, id: 'src', options: { noResolve: true, src: true } }]);
    expect(r.rulesets['rs_rs_classical.list']!.text).toBe('DOMAIN,example.test\nGEOIP,CN\nIP-CIDR,192.0.2.0/24\n');
    expect(r.rulesets['rs_rs_src_classical.list']!.text).toBe('DOMAIN,example.test\nGEOIP,CN,src\nIP-CIDR,192.0.2.0/24,src\n');
    expect(r.config.rules).toContain('RULE-SET,R_2,DIRECT');
    expect(r.config.rules).toContain('RULE-SET,R,DIRECT');
  });

  it('单条规则的规则级 src 进入最终输出', () => {
    const r = render('', [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '192.0.2.0/24' } }, options: { src: true }, target: to }]);
    expect(r.config.rules).toContain('IP-CIDR,192.0.2.0/24,DIRECT,src');
  });

  it.each([true, false])('旧独立开关 %s 不改变 RAW 和结构化单条自身的标记', noResolve => {
    const rules: RuleEntry[] = [
      { id: 'raw-on', matcher: { kind: 'rule', rule: { type: 'RAW', text: 'IP-CIDR,192.0.2.0/24,no-resolve' } }, target: to, options: { noResolve } },
      { id: 'raw-off', matcher: { kind: 'rule', rule: { type: 'RAW', text: 'IP-CIDR,198.51.100.0/24' } }, target: to, options: { noResolve } },
      { id: 'ir-on', matcher: { kind: 'rule', rule: { type: 'IP-CIDR6', value: '2001:db8::/32', noResolve: true } }, target: to, options: { noResolve } },
      { id: 'ir-off', matcher: { kind: 'rule', rule: { type: 'GEOIP', value: 'CN' } }, target: to, options: { noResolve } },
    ];
    expect(render('', rules).config.rules).toEqual([
      'IP-CIDR,192.0.2.0/24,DIRECT,no-resolve', 'IP-CIDR,198.51.100.0/24,DIRECT',
      'IP-CIDR6,2001:db8::/32,DIRECT,no-resolve', 'GEOIP,CN,DIRECT', 'MATCH,DIRECT',
    ]);
  });
});
