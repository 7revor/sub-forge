import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { Report, profileEditorOverlay, resolveProfileRouting } from '../src/index.ts';
import type { Profile, RuleEntry, Target } from '../src/types.ts';
import { render, TEMPLATE } from './fixtures/scenarios.ts';

const rule = (id: string, target: Target = { kind: 'builtin', name: 'DIRECT' }): RuleEntry => ({ id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: `${id}.test` } }, target });
const node: Target = { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '🇭🇰 IPLC-01' }, fallback: { kind: 'builtin', name: 'REJECT' } } };
const bound = (prependRules?: RuleEntry[]): Profile['routing'] => ({ mode: 'bound', templateId: TEMPLATE.id, groupAdditions: {}, ...(prependRules ? { prependRules } : {}) });

describe('绑定订阅的前置单条规则', () => {
  it('按保存顺序位于全部模板规则前，禁用规则不输出，MATCH 保留模板出口', () => {
    const first = rule('first');
    const second = rule('second', { kind: 'group', groupId: 'sel' });
    const result = render({ routing: bound([first, { ...rule('off'), enabled: false }, second]) });
    expect((result.config.rules as string[]).slice(0, 3)).toEqual(['DOMAIN,first.test,DIRECT', 'DOMAIN,second.test,🚀 节点选择', 'RULE-SET,rs_fin_classical,🚀 节点选择']);
    expect((result.config.rules as string[]).at(-1)).toBe('MATCH,🚀 节点选择');
    expect(profileEditorOverlay({ overlay: {}, routing: bound([first, second]) }).extraRules?.map(extra => extra.rule.id)).toEqual(['second', 'first']);
  });

  it.each(['wrap', 'copy', 'inline'] as const)('远端 provider 节点和代理链共享 %s 依赖解析，重复引用复用依赖', strategy => {
    const result = render({
      nodeSets: [{ ref: { type: 'source', id: 'T' }, output: 'provider' }, { ref: { type: 'source', id: 'L' }, output: 'provider' }],
      routing: bound([rule('node', node)]), refPolicy: { default: strategy },
      chains: [{ id: 'chain', landing: { nodeSet: { type: 'source', id: 'L' } }, via: node }],
    });
    expect(result.report.items.filter(item => item.level === 'error')).toEqual([]);
    if (strategy === 'inline') {
      expect(result.providers['source:T']).toBeUndefined();
      expect(result.config.rules).toContain('DOMAIN,node.test,🇭🇰 IPLC-01');
    } else {
      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0]).toMatchObject({ strategy, usedBy: ['chain:chain', 'rule:node'] });
      const output = result.dependencies[0]!.output;
      expect(result.config.rules).toContain(`DOMAIN,node.test,${output}`);
      if (strategy === 'wrap') expect(result.config['proxy-groups']).toContainEqual(expect.objectContaining({ name: output, use: ['中转'], hidden: true }));
      else expect(result.config.proxies).toContainEqual(expect.objectContaining({ name: output }));
      expect(parse(result.providers['source:T']!.yaml).proxies).toHaveLength(2);
    }
  });

  it('只有规则引用的远端节点也生成依赖，未命中使用同一兜底', () => {
    const result = render({ nodeSets: [{ ref: { type: 'source', id: 'T' }, output: 'provider' }], routing: bound([rule('node', node)]) });
    expect(result.dependencies[0]?.usedBy).toEqual(['rule:node']);
    const missing: Target = { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '已消失' }, fallback: { kind: 'builtin', name: 'REJECT' } } };
    const fallback = render({ nodeSets: [{ ref: { type: 'source', id: 'T' }, output: 'provider' }], routing: bound([rule('gone', missing)]) });
    expect(fallback.config.rules).toContain('DOMAIN,gone.test,REJECT');
    expect(fallback.report.byCode('ref.fallback')).toHaveLength(1);
  });

  it('模板更新后前置规则仍在最前，ID 冲突报告错误', () => {
    const routing = bound([rule('first')]);
    const next = { ...TEMPLATE, version: 2, rules: [rule('new'), ...TEMPLATE.rules] };
    const effective = resolveProfileRouting({ routing, overlay: {} }, next, new Report());
    expect(effective.rules.map(r => r.id)).toEqual(['first', 'new', ...TEMPLATE.rules.map(r => r.id)]);
    const collision = new Report();
    resolveProfileRouting({ routing: bound([rule('r-fin')]), overlay: {} }, TEMPLATE, collision);
    expect(collision.byCode('binding.duplicate-rule')).toHaveLength(1);
  });
});

it('禁用前置规则与节点兜底引用的组也参与模板更新检查', () => {
  const routing: Profile['routing'] = { mode: 'bound', templateId: TEMPLATE.id, groupAdditions: {}, prependRules: [
    { ...rule('disabled', { kind: 'group', groupId: 'gone' }), enabled: false },
    rule('fallback', { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '🇭🇰 IPLC-01' }, fallback: { kind: 'group', groupId: 'gone' } } }),
  ] };
  const report = new Report();
  resolveProfileRouting({ routing, overlay: {} }, TEMPLATE, report);
  expect(report.byCode('binding.prepend-target').map(item => item.where)).toEqual(['rule:disabled', 'rule:fallback']);
});

it('前置规则抽取的本地副本纳入 include-all-proxies 的代理链成环检查', () => {
  const routing: Profile['routing'] = { mode: 'bound', templateId: TEMPLATE.id, groupAdditions: { sel: [{ kind: 'all', scope: 'proxies' }] }, prependRules: [rule('copy', node)] };
  const result = render({ nodeSets: [{ ref: { type: 'source', id: 'T' }, output: 'provider' }], routing, refPolicy: { default: 'copy' },
    chains: [{ id: 'loop', landing: { nodeSet: { type: 'source', id: 'T' }, filter: '^🇭🇰 IPLC-01$' }, via: { kind: 'group', groupId: 'sel' } }],
  });
  expect(result.report.byCode('chain.cycle')).toHaveLength(1);
});
