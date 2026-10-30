import { describe, expect, it } from 'vitest';
import type { GroupSpec, Profile } from '@sub-forge/core';
import { associationRequirements, inferAssociationMapping } from './associationModel.ts';
const groups: GroupSpec[] = [
  { id: 'main', name: '科学上网', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] },
  { id: 'relay', name: '前置', type: 'select', members: [] },
  { id: 'unused', name: '无填充', type: 'select', members: [] },
];
const profile: Profile = { id: 'p', name: '订阅', overlay: {}, nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups, rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } };
describe('模板关联迁移', () => {
  it('无填充且未被引用的组不要求映射，填充可以明确放弃', () => {
    expect(associationRequirements(profile, groups)).toEqual([{ id: 'main', name: '科学上网', reasons: ['1 项节点填充'], canDrop: true }]);
  });
  it('代理链引用的空组仍需映射，不能丢弃', () => {
    const next = { ...profile, chains: [{ id: 'c', landing: { nodeSet: { type: 'local' as const, id: 'nodes' } }, via: { kind: 'group' as const, groupId: 'relay' } }] };
    expect(associationRequirements(next, groups)).toContainEqual({ id: 'relay', name: '前置', reasons: ['代理链引用'], canDrop: false });
  });
  it('绑定订阅的成员引用和前置规则出口都保留，明确丢弃填充时移除其依赖', () => {
    const next: Profile = { ...profile, routing: { mode: 'bound', templateId: 't', groupAdditions: { main: [{ kind: 'group', groupId: 'relay' }] }, prependRules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.test' } }, target: { kind: 'group', groupId: 'unused' } }] } };
    expect(associationRequirements(next, groups).map(g => [g.id, g.canDrop])).toEqual([['main', true], ['relay', false], ['unused', false]]);
    expect(associationRequirements(next, groups, { main: '__drop' }).map(g => g.id)).toEqual(['main', 'unused']);
  });
  it('节点回退引用的组不能遗漏', () => {
    const nodeGroups: GroupSpec[] = [{ ...groups[0]!, members: [{ kind: 'node', ref: { nodeSet: { type: 'local', id: 'nodes' }, match: { exact: 'GCP' }, fallback: { kind: 'group', groupId: 'relay' } } }] }, groups[1]!];
    expect(associationRequirements(profile, nodeGroups).find(g => g.id === 'relay')?.canDrop).toBe(false);
  });
  it('优先同 ID，其次唯一同名；同名歧义不擅自决定', () => {
    expect(inferAssociationMapping(groups, [{ ...groups[0]!, name: '改名' }, { ...groups[1]!, id: 'new' }])).toEqual({ main: 'main', relay: 'new' });
    expect(inferAssociationMapping(groups, [{ ...groups[1]!, id: 'a' }, { ...groups[1]!, id: 'b' }])).toEqual({});
  });
});
