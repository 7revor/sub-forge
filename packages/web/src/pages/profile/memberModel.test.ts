import { describe, expect, it } from 'vitest';
import type { ChainRule, GroupMember, GroupSpec } from '@sub-forge/core';
import { canReferenceGroup, chainInputError, exactNodeFilter, putChain, toggleMember } from './memberModel.ts';
const node: GroupMember = { kind: 'node', ref: { nodeSet: { type: 'local', id: 'local' }, match: { exact: 'GCP' }, fallback: { kind: 'builtin', name: 'REJECT' } } };
describe('成员填充与链规则', () => {
  it('反复勾选不重复添加，取消勾选不影响其他成员', () => {
    const first: GroupMember = { kind: 'builtin', name: 'DIRECT' };
    expect(toggleMember([first, node], node, true)).toEqual([first, node]);
    expect(toggleMember([first, node], node, false)).toEqual([first]);
    expect(toggleMember([first], node, true, [node])).toEqual([first]);
  });
  it('同名节点不同来源各自保留', () => {
    if (node.kind !== 'node') throw new Error('测试节点类型错误');
    const second = { ...node, ref: { ...node.ref, nodeSet: { type: 'local' as const, id: 'other' } } };
    expect(toggleMember([node], second, true)).toHaveLength(2);
  });
  it('节点名称中正则特殊字符必须原样匹配，不能扩展到其他落地', () => {
    const name = 'US [GCP]+(1).test$\\结束';
    const regex = new RegExp(exactNodeFilter(name));
    expect(regex.test(name)).toBe(true);
    expect(regex.test(`${name}副本`)).toBe(false);
    expect(regex.test('US GCP111test')).toBe(false);
  });
  it('拒绝直接和间接成环的组引用', () => {
    const groups: GroupSpec[] = [{ id: 'a', name: '甲', type: 'select', members: [] }, { id: 'b', name: '乙', type: 'select', members: [{ kind: 'group', groupId: 'a' }] }, { id: 'c', name: '丙', type: 'select', members: [{ kind: 'group', groupId: 'b' }] }];
    expect(canReferenceGroup(groups, 'a', 'a')).toBe(false);
    expect(canReferenceGroup(groups, 'a', 'c')).toBe(false);
    expect(canReferenceGroup(groups, 'c', 'a')).toBe(true);
  });
  it('链规则支持筛选、排除和前置节点，阻止无效正则和未选前置', () => {
    const chain: ChainRule = { id: 'c', landing: { nodeSet: { type: 'local', id: 'landing' }, filter: 'GCP', excludeFilter: '过期' }, via: node };
    expect(chainInputError(chain)).toBeUndefined();
    expect(chainInputError({ ...chain, landing: { ...chain.landing, filter: '[' } })).toBeTruthy();
    expect(chainInputError({ ...chain, via: { kind: 'group', groupId: '' } })).toBeTruthy();
  });
  it('整集不能以前置自身绕行，排除该节点后允许同源链', () => {
    const chain: ChainRule = { id: 'same', landing: { nodeSet: { type: 'local', id: 'local' } }, via: node };
    expect(chainInputError(chain)).toContain('循环');
    expect(chainInputError({ ...chain, landing: { ...chain.landing, excludeFilter: '^GCP$' } })).toBeUndefined();
  });
  it('修改规则范围时按原 ID 更新，不能覆盖另一条并留下重复 ID', () => {
    const a: ChainRule = { id: 'a', landing: { nodeSet: { type: 'local', id: 'local' }, filter: 'a' }, via: node };
    const b = { ...a, id: 'b', landing: { ...a.landing, filter: 'b' } };
    const next = putChain([a, b], { ...b, landing: a.landing });
    expect(next.map(c => c.id)).toEqual(['a', 'b']);
    expect(next[0]).toEqual(a);
  });

});
