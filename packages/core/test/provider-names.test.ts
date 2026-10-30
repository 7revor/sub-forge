import { expect, it } from 'vitest';
import { allocateRuleProviderNames, ruleProviderName } from '../src/rules/provider-name.ts';
import { remoteRuleMatcher, renderMihomo, type Profile } from '../src/index.ts';

it('名称优先使用原名，直接 URL 使用解码后的无扩展名文件名，特殊字符不破坏规则行', () => {
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { id: 'r', name: '规则增强', sources: [] })).toBe('规则增强');
  expect(ruleProviderName(remoteRuleMatcher('https://rules.test/%E8%8B%B9%E6%9E%9C.list?secret=hidden'), { id: '', name: '原URL', sources: [] })).toBe('苹果');
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { id: 'r', name: 'A,B\nC', sources: [] })).toBe('A，B C');
});

it('重名稳定加后缀，预留其他资源的原始名字，顺序调整不更名', () => {
  const entries = new Map([['a', 'Apple'], ['b', 'Apple'], ['c', 'Apple (2)'], ['d', 'Apple']]);
  const names = allocateRuleProviderNames(entries);
  expect([...names.values()]).toEqual(['Apple', 'Apple (3)', 'Apple (2)', 'Apple (4)']);
  expect(allocateRuleProviderNames(new Map([...entries].reverse()))).toEqual(names);
});

it.each(['同名', '__proto__', 'constructor'])('同名规则增强「%s」拥有不同 provider 名称和正文，相同引用复用 provider', name => {
  const profile: Profile = { id: 'p', name: '名称', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, routing: { mode: 'independent', config: {
    groups: [], rules: ['a', 'b', 'a'].map((id, i) => ({ id: `rule-${i}`, matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'DIRECT' } })), final: { kind: 'builtin', name: 'DIRECT' },
  } } };
  const out = renderMihomo({ profile, nodeSets: { sources: {}, locals: {}, collections: {}, snapshots: {} }, rules: { snapshots: {}, rulesets: Object.fromEntries(['a', 'b'].map(id => [id, { id, name, sources: [{ id: 'l', kind: 'local', format: 'auto', content: `DOMAIN,${id}.test` }] }])) }, urls: { provider: key => key, ruleset: key => key } });
  expect(out.report.hasErrors).toBe(false);
  expect(Object.keys(out.config['rule-providers'] as object)).toEqual([name, `${name} (2)`]);
  expect(out.config.rules).toEqual([`RULE-SET,${name},DIRECT`, `RULE-SET,${name} (2),DIRECT`, `RULE-SET,${name},DIRECT`, 'MATCH,DIRECT']);
  expect(Object.values(out.rulesets).map(file => file.text)).toEqual(['DOMAIN,a.test\n', 'DOMAIN,b.test\n']);
});
