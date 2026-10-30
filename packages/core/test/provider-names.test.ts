import { expect, it } from 'vitest';
import { allocateRuleProviderNames, ruleProviderName } from '../src/rules/provider-name.ts';
import { remoteRuleMatcher, renderMihomo, type Profile, type RuleSetSource } from '../src/index.ts';

it('名称优先使用原名，直接 URL 使用解码后的无扩展名文件名，特殊字符不破坏规则行', () => {
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { id: 'r', name: '规则增强', sources: [] })).toBe('规则增强');
  expect(ruleProviderName(remoteRuleMatcher('https://rules.test/%E8%8B%B9%E6%9E%9C.list?secret=hidden'), { id: '', name: '原URL', sources: [] })).toBe('苹果');
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { id: 'r', name: 'A,B\nC', sources: [] })).toBe('A，B C');
});

it('仓库直接引用使用文件名，规则增强优先使用名称，未命名增强回退到有效来源文件名', () => {
  const source: RuleSetSource = { id: 's', kind: 'remote', format: 'auto', name: 'blackmatrix7 · rule/Surge/Lan/Lan.list',
    url: 'https://rules.test/Lan.list', repository: { repo: 'blackmatrix7', entry: 'Lan', ref: 'master', path: 'rule/Surge/Lan/Lan.list' } };
  const rs = { id: 'r', name: 'blackmatrix7 · rule/Surge/Lan/Lan.list · master', sources: [source] };
  expect(ruleProviderName({ kind: 'ruleset', id: 'r', repository: { repo: 'blackmatrix7', entry: 'Lan', name: rs.name, sources: [source] } }, rs)).toBe('Lan');
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { ...rs, name: '局域网增强' })).toBe('局域网增强');
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { ...rs, name: ' ', sources: [{ ...source, id: 'disabled', enabled: false, repository: { ...source.repository!, path: '旧规则.list' } }, source] })).toBe('Lan');
  expect(ruleProviderName({ kind: 'ruleset', id: 'r' }, { ...rs, name: '', sources: [{ ...source, repository: undefined, url: 'https://rules.test/%E8%8B%B9%E6%9E%9C.list.gz?token=hidden' }] })).toBe('苹果');
});

it.each(['规则.list', '规则.yaml', '规则.list.gz', '规则.conf', '规则.mrs', '规则.srs', '规则'])('文件名「%s」只保留无后缀名称', file => {
  expect(ruleProviderName(remoteRuleMatcher(`https://rules.test/${encodeURIComponent(file)}`), { id: '', name: '原URL', sources: [] })).toBe('规则');
});

it('重名稳定加后缀，预留其他资源的原始名字，顺序调整不更名', () => {
  const entries = new Map([['a', 'Apple'], ['b', 'Apple'], ['c', 'Apple_2'], ['d', 'Apple']]);
  const names = allocateRuleProviderNames(entries);
  expect([...names.values()]).toEqual(['Apple', 'Apple_3', 'Apple_2', 'Apple_4']);
  expect(allocateRuleProviderNames(new Map([...entries].reverse()))).toEqual(names);
});

it.each(['同名', '__proto__', 'constructor'])('同名规则增强「%s」拥有不同 provider 名称和正文，相同引用复用 provider', name => {
  const profile: Profile = { id: 'p', name: '名称', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, routing: { mode: 'independent', config: {
    groups: [], rules: ['a', 'b', 'a'].map((id, i) => ({ id: `rule-${i}`, matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'DIRECT' } })), final: { kind: 'builtin', name: 'DIRECT' },
  } } };
  const out = renderMihomo({ profile, nodeSets: { sources: {}, locals: {}, collections: {}, snapshots: {} }, rules: { snapshots: {}, rulesets: Object.fromEntries(['a', 'b'].map(id => [id, { id, name, sources: [{ id: 'l', kind: 'local', format: 'auto', content: `DOMAIN,${id}.test` }] }])) }, urls: { provider: key => key, ruleset: key => key } });
  expect(out.report.hasErrors).toBe(false);
  expect(Object.keys(out.config['rule-providers'] as object)).toEqual([name, `${name}_2`]);
  expect(out.config.rules).toEqual([`RULE-SET,${name},DIRECT`, `RULE-SET,${name}_2,DIRECT`, `RULE-SET,${name},DIRECT`, 'MATCH,DIRECT']);
  expect(Object.values(out.rulesets).map(file => file.text)).toEqual(['DOMAIN,a.test\n', 'DOMAIN,b.test\n']);
});
