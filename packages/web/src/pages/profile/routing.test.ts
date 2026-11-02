import { describe, expect, it } from 'vitest';
import { Report, resolveProfileRouting, routingConfig, type RoutingConfig } from '@sub-forge/core';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';
import { acceptProfileSave, editableProfileGroups, syncProfileDraft, withRoutingGroups, withRoutingRules } from './routing.ts';
import { removeIndependentGroup } from './providerGroup.ts';
const config: RoutingConfig = {
  groups: [{ id: 'a', name: '甲', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }], test: { interval: 300 } }, { id: 'b', name: '乙', type: 'fallback', members: [{ kind: 'group', groupId: 'a' }] }],
  rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'test.local' } }, target: { kind: 'group', groupId: 'a' }, options: { src: true } }], final: { kind: 'group', groupId: 'b' },
};
const profile: ProfileDoc = { id: 'p', name: '配置', nodeSets: [], chains: [], routing: { mode: 'independent', config } };
const template: TemplateDoc = { id: 't', groups: [{ id: 'tpl', name: '模板组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [{ ...config.rules[0]!, id: 'tpl-rule', target: { kind: 'group', groupId: 'tpl' } }], final: { kind: 'group', groupId: 'tpl' } };
const bound: ProfileDoc = { ...profile, routing: { mode: 'bound', templateId: 't', groupAdditions: { tpl: [{ kind: 'group', groupId: 'a' }] }, groupHidden: { tpl: false }, extraGroups: config.groups, prependGroupIds: ['a'], prependRules: config.rules, appendRules: [{ ...config.rules[0]!, id: 'last' }] } };
const effective = (p: ProfileDoc) => routingConfig(resolveProfileRouting(p, template, new Report()));

describe('直接编辑 routing', () => {
  it('独立组编辑保留顺序、规则选项、节点引用与最终出口，原草稿不变', () => {
    const before = structuredClone(profile);
    const next = withRoutingGroups(profile, { ...config, groups: config.groups.map(group => ({ ...group, name: `${group.name}改` })) }, undefined);
    expect(next.routing.mode).toBe('independent');
    if (next.routing.mode !== 'independent') throw new Error('模式错误');
    expect(next.routing.config.rules).toEqual(config.rules);
    expect(next.routing.config.final).toEqual(config.final);
    expect(next.routing.config.groups.map(group => group.name)).toEqual(['甲改', '乙改']);
    expect(next.routing.config.groups[1]!.members).toEqual([{ kind: 'group', groupId: 'a' }]);
    expect(profile).toEqual(before);
  });

  it('弹窗继承成员与追加成员分开展示，反复派生不叠加', () => {
    const before = structuredClone(bound);
    const groups = editableProfileGroups(bound, template);
    expect(groups[0]!.members).toEqual([{ kind: 'builtin', name: 'DIRECT' }]);
    expect(groups.map(group => group.origin)).toEqual(['template', 'profile', 'profile']);
    expect(editableProfileGroups(bound, template)).toEqual(groups);
    expect(bound).toEqual(before);
    expect(editableProfileGroups(profile, template).map(group => group.id)).toEqual(['a', 'b']);
  });

  it('绑定组跨模板整体排序，仅更新独立组和前置标记，保留成员、规则与 false', () => {
    const body = effective(bound);
    expect(body.groups.map(group => group.id)).toEqual(['a', 'tpl', 'b']);
    const next = withRoutingGroups(bound, { ...body, groups: [body.groups[2]!, body.groups[1]!, body.groups[0]!] }, template);
    expect(next.routing).toMatchObject({ groupAdditions: { tpl: [{ kind: 'group', groupId: 'a' }] }, groupHidden: { tpl: false }, prependGroupIds: ['b'], prependRules: config.rules });
    expect(effective(next).groups.map(group => group.id)).toEqual(['b', 'tpl', 'a']);
    expect(withRoutingGroups(next, effective(next), template)).toEqual(next);
  });

  it('规则跨模板整体排序、编辑、删除后保留显示顺序与组配置', () => {
    const body = effective(bound);
    const rules = [body.rules[2]!, body.rules[1]!, { ...body.rules[0]!, target: { kind: 'builtin' as const, name: 'REJECT' as const } }];
    const next = withRoutingRules(bound, { ...body, rules }, template);
    expect(next.routing).toMatchObject({ prependRules: [{ id: 'last' }], appendRules: [{ id: 'r', target: { name: 'REJECT' } }], groupHidden: { tpl: false }, prependGroupIds: ['a'] });
    expect(effective(next).rules.map(rule => rule.id)).toEqual(['last', 'tpl-rule', 'r']);
    expect(withRoutingRules(next, effective(next), template)).toEqual(next);
    expect(withRoutingRules(next, { ...body, rules: template.rules }, template).routing).toMatchObject({ prependRules: [], appendRules: [] });
  });

  it('空模板依赖显式分隔位置保存两侧组与规则', () => {
    const empty = { ...template, groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
    const groups = withRoutingGroups(bound, config, empty, 1);
    expect(groups.routing).toMatchObject({ prependGroupIds: ['a'] });
    const rules = withRoutingRules(groups, { ...config, rules: [config.rules[0]!, { ...config.rules[0]!, id: 'after' }] }, empty, 1);
    expect(rules.routing).toMatchObject({ prependRules: [{ id: 'r' }], appendRules: [{ id: 'after' }] });
  });

  it('删除独立组清理两侧规则、前置标记和成员引用，保留隐藏设置', () => {
    const next = removeIndependentGroup(bound, 'a');
    expect(next.routing).toMatchObject({ groupAdditions: {}, groupHidden: { tpl: false }, extraGroups: [{ id: 'b', members: [] }], prependGroupIds: [], prependRules: [{ id: 'r', target: { name: 'REJECT' } }], appendRules: [{ id: 'last', target: { name: 'REJECT' } }] });
    const independent = removeIndependentGroup(profile, 'b');
    expect(independent.routing).toMatchObject({ config: { final: { kind: 'builtin', name: 'REJECT' }, groups: [{ id: 'a' }] } });
  });
});

it('后台刷新不覆盖转换草稿，保存期间的新输入保留', () => {
  const initial = { ...profile };
  const converted: ProfileDoc = { ...initial, routing: { mode: 'bound', templateId: 't', groupAdditions: {} } };
  const remote = { ...initial, name: '另一处编辑' };
  expect(syncProfileDraft(initial, initial, remote)).toBe(remote);
  expect(syncProfileDraft(converted, initial, remote)).toBe(converted);
  const saved = { ...converted };
  expect(acceptProfileSave(converted, converted, saved)).toBe(saved);
  const typing = { ...converted, name: '保存期间继续编辑' };
  expect(acceptProfileSave(typing, converted, saved)).toBe(typing);
  expect(syncProfileDraft(converted, remote, { ...remote, id: 'other' }).id).toBe('other');
});
