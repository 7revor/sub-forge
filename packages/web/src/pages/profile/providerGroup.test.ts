import { describe, expect, it } from 'vitest';
import type { ProfileDoc } from '../../hooks.ts';
import { profileEditorOverlay } from '@sub-forge/core';
import { appendProviderGroup, removeIndependentGroup } from './providerGroup.ts';
import { associationRequirements } from './associationModel.ts';
const ref = { type: 'local' as const, id: 's' };
const base: ProfileDoc = { id: 'p', name: '订阅', nodeSets: [{ ref, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' } };
describe('Provider 快捷独立组', () => {
  it.each(['bound', 'independent'] as const)('%s 模式保存动态节点集成员，重名递增且原草稿不变', mode => {
    const profile: ProfileDoc = { ...base, routing: mode === 'bound' ? { mode, templateId: 't', groupAdditions: {} } : { mode, config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } };
    const snapshot = structuredClone(profile);
    const next = appendProviderGroup(profile, ref, '机场', [{ name: '机场' }, { name: '机场 2' }]);
    const groups = profileEditorOverlay(next).extraGroups!;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.group).toMatchObject({ name: '机场 3', type: 'select', members: [{ kind: 'nodeset', ref }] });
    expect(next.overlay).toEqual({});
    expect(profile).toEqual(snapshot);
    expect(appendProviderGroup({ ...profile, nodeSets: [{ ref, output: 'inline' }] }, ref, '机场', [])).toEqual({ ...profile, nodeSets: [{ ref, output: 'inline' }] });
  });
  it('删除独立组处理追加成员、嵌套兜底、前置规则与代理链；切换模板仅映射模板引用', () => {
    const target = { kind: 'group' as const, groupId: 'private' };
    const profile: ProfileDoc = { ...base, chains: [{ id: 'chain', via: target, landing: { nodeSet: ref } }], routing: { mode: 'bound', templateId: 't', groupAdditions: { tpl: [target] }, extraGroups: [
      { id: 'private', name: '独立', type: 'select', members: [{ kind: 'group', groupId: 'tpl' }] },
      { id: 'second', name: '另一组', type: 'select', members: [target, { kind: 'node', ref: { nodeSet: ref, match: { exact: '节点' }, fallback: target } }] },
    ], prependRules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'test.local' } }, target }] } };
    expect(associationRequirements(profile, profile.routing?.mode === 'bound' ? profile.routing.extraGroups! : []).map(g => g.id)).toEqual(['tpl']);
    const next = removeIndependentGroup(profile, 'private');
    expect(next.chains).toEqual([]);
    expect(next.routing).toMatchObject({ groupAdditions: {}, extraGroups: [{ id: 'second', members: [{ kind: 'node', ref: { fallback: { kind: 'builtin', name: 'REJECT' } } }] }], prependRules: [{ target: { kind: 'builtin', name: 'REJECT' } }] });
  });
});
