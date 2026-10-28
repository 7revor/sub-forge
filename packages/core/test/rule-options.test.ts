import { describe, expect, it } from 'vitest';
import { renderMihomo } from '../src/render/mihomo.ts';
import { composeRule, lowerRule } from '../src/rules/client.ts';
import { parseRuleLine } from '../src/rules/parse.ts';
import type { RuleEntry } from '../src/types.ts';

const to = { kind: 'builtin' as const, name: 'DIRECT' as const };
const render = (content: string, entries: RuleEntry[] = [{ id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: to }]) => renderMihomo({
  profile: { id: 'p', name: 'P', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: entries.map(rule => ({ anchor: 'bottom', rule })) } },
  nodeSets: { sources: {}, collections: {}, locals: {}, snapshots: {} },
  rules: { rulesets: { rs: { id: 'rs', name: 'R', kind: 'local', format: 'classical', content } }, bundles: {}, snapshots: {} },
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

  it('规则集 CIDR 上的 no-resolve 转移到 RULE-SET，不丢失', () => {
    const r = render('IP-CIDR,192.0.2.0/24,no-resolve');
    expect(r.config.rules).toEqual(['RULE-SET,rs_rs_ipcidr,DIRECT,no-resolve', 'MATCH,DIRECT']);
    expect(r.rulesets.rs_rs_ipcidr!.text).toBe('192.0.2.0/24\n');
  });

  it('混合选项按连续段输出，不把需要解析的规则一起禁止解析', () => {
    const r = render('IP-CIDR,192.0.2.0/24,no-resolve\nIP-CIDR,198.51.100.0/24\nIP-CIDR,203.0.113.0/24,no-resolve,src');
    expect(r.config.rules).toEqual(['RULE-SET,rs_rs_ipcidr_part1,DIRECT,no-resolve', 'RULE-SET,rs_rs_ipcidr_part2,DIRECT', 'RULE-SET,rs_rs_ipcidr_part3,DIRECT,no-resolve,src', 'MATCH,DIRECT']);
    expect(Object.values(r.rulesets).map(x => x.text)).toEqual(['192.0.2.0/24\n', '198.51.100.0/24\n', '203.0.113.0/24\n']);
  });

  it('同一规则集的不同规则级选项互不污染，classical 中的 IP 选项也保留', () => {
    const plain: RuleEntry = { id: 'plain', matcher: { kind: 'ruleset', id: 'rs' }, target: to };
    const r = render('DOMAIN,example.test\nGEOIP,CN\nIP-CIDR,192.0.2.0/24', [plain, { ...plain, id: 'src', options: { noResolve: true, src: true } }]);
    expect(r.rulesets.rs_rs_classical!.text).toBe('GEOIP,CN\n');
    expect(r.rulesets.rs_rs_nr_src_classical!.text).toBe('GEOIP,CN,no-resolve,src\n');
    expect(r.config.rules).toContain('RULE-SET,rs_rs_nr_src_ipcidr,DIRECT,no-resolve,src');
    expect(r.config.rules).toContain('RULE-SET,rs_rs_nr_src_domain,DIRECT');
  });

  it('单条规则的规则级 src 进入最终输出', () => {
    const r = render('', [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '192.0.2.0/24' } }, options: { src: true }, target: to }]);
    expect(r.config.rules).toContain('IP-CIDR,192.0.2.0/24,DIRECT,src');
  });
});
