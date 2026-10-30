import { describe, expect, it } from 'vitest';
import { convertRuleDocuments, prepareRuleDocument, renderMihomo, renderStash, type RenderInput, type RuleSet } from '../src/index.ts';
import { direct, iniFixture, routing } from './fixtures/ini-client.ts';

function fixture(rs: RuleSet): RenderInput {
  const input = iniFixture();
  input.base = '';
  input.profile.nodeSets = [];
  routing(input).groups = [];
  routing(input).rules = [{ id: 'set', matcher: { kind: 'ruleset', id: rs.id }, target: direct }];
  input.rules.rulesets = { [rs.id]: rs };
  return input;
}

describe('主配置与规则集诊断的边界', () => {
  it('规则集仍保留转换诊断与注释，主配置不重复报告逐行处理', () => {
    const rs: RuleSet = { id: 'rs', name: '规则集', sources: [{ id: 's', kind: 'local', format: 'classical', content: [
      'DOMAIN,valid.test', 'DOMAIN,valid.test', 'USER-AGENT,Example*', 'UNKNOWN,value', 'IP-CIDR,', 'DOMAIN,removed.test',
    ].join('\n') }], overrides: [{ match: 'DOMAIN,removed.test', override: { when: { client: 'mihomo' }, action: { drop: true } } }] };
    const source = rs.sources[0]!;
    const converted = convertRuleDocuments(rs, new Map([[source.id, prepareRuleDocument(source.content!, source)]]), { client: 'mihomo' });
    expect(converted.stats).toMatchObject({ output: 1, duplicates: 1, unsupported: 1, rejected: 2, removed: 1 });
    expect(converted.diagnostics.map(item => item.kind)).toEqual(expect.arrayContaining(['duplicate', 'client', 'unimplemented', 'invalid', 'override']));
    const out = renderMihomo(fixture(rs));
    expect(out.report.items).toEqual([]);
    expect(Object.values(out.rulesets)[0]!.text).toBe(converted.lines.join('\n') + '\n');
    expect(out.config.rules).toEqual(['RULE-SET,规则集,DIRECT', 'MATCH,DIRECT']);
  });

  it('手写规则的丢弃与适配提示仍可见，规则集的相同适配不重复报告', () => {
    const input = fixture({ id: 'rs', name: '规则集', sources: [{ id: 's', kind: 'local', format: 'classical', content: 'SRC-IP-CIDR,192.0.2.0/24' }] });
    routing(input).rules.push(
      { id: 'manual-drop', matcher: { kind: 'rule', rule: { type: 'URL-REGEX', value: '^https://example.test' } }, target: direct },
      { id: 'manual-adapt', matcher: { kind: 'rule', rule: { type: 'SRC-IP-CIDR', value: '192.0.2.0/24' } }, target: direct },
    );
    const out = renderStash(input);
    expect(out.report.items).toEqual([
      expect.objectContaining({ code: 'rule.dropped', where: 'rule:manual-drop' }),
      expect.objectContaining({ code: 'rule.degraded', where: 'rule:manual-adapt' }),
    ]);
    expect(out.config.rules).toContain('SRC-IP,192.0.2.0/24,DIRECT');
  });

  it('保留缺少快照与远程规则转换无有效输出的阻断错误', () => {
    const input = fixture({ id: 'rs', name: '远程规则集', sources: [{ id: 's', kind: 'remote', format: 'classical', url: 'https://example.test/rules' }] });
    expect(renderMihomo(input).report.byCode('ruleset.no-snapshot')).toHaveLength(1);
    routing(input).rules[0]!.matcher = { kind: 'ruleset', id: 'rs', remote: { url: 'https://example.test/rules' } };
    input.rules.rulesets.rs!.sources = [{ id: 's', kind: 'local', format: 'classical', content: 'USER-AGENT,Example*' }];
    const out = renderMihomo(input);
    expect(out.report.hasErrors).toBe(true);
    expect(out.report.byCode('ruleset.empty-conversion')).toHaveLength(1);
    expect(out.rulesets).toEqual({});
  });
});
