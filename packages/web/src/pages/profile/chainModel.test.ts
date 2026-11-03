import { describe, expect, it } from 'vitest';
import type { ChainRule, GroupMember, Profile, Target } from '@sub-forge/core';
import { cascadeDescription, chainUsesNodeSet, hasCascade, landingConstraintHint, landingNodeName, landingNodeNames, planProfileChange, removeProfileNodeSet, viaConstraintHint } from './chainModel.ts';
import { chainInputError, exactNodeFilter, selectedNodeFilter } from './memberModel.ts';
const landing = { type: 'local' as const, id: 'landing' };
const relay = { type: 'local' as const, id: 'relay' };
const chain = { id: 'c', landing: { nodeSet: landing }, via: { kind: 'node', ref: { nodeSet: relay, match: { regex: '香港|HK' }, fallback: 'error' } } } satisfies ChainRule;
describe('流量顺序代理链', () => {
  it.each(['🇺🇸 GCP [01]', '节点.*+?^${}()|[]\\尾', '香港'])('精确落地名称可无损回显：%s', name => {
    expect(landingNodeName({ nodeSet: landing, filter: exactNodeFilter(name) })).toBe(name);
  });
  it.each(['.*', '^香港.*$', '香港', '^A|B$'])('历史落地筛选不冒充单个节点：%s', filter => {
    expect(landingNodeName({ nodeSet: landing, filter })).toBeUndefined();
  });
  it('排除条件和整集范围保留为历史范围', () => {
    expect(landingNodeName({ nodeSet: landing })).toBeUndefined();
    expect(landingNodeName({ nodeSet: landing, filter: '^节点$', excludeFilter: '过期' })).toBeUndefined();
  });
  it('勾选生成的多节点筛选可还原，转义的竖线不被拆开', () => {
    expect(landingNodeNames({ nodeSet: landing, filter: selectedNodeFilter(['甲|乙', '🇺🇸 GCP [01]']) })).toEqual(['甲|乙', '🇺🇸 GCP [01]']);
    expect(landingNodeNames({ nodeSet: landing, filter: '^甲$|香港' })).toBeUndefined();
    expect(landingNodeNames({ nodeSet: landing, filter: selectedNodeFilter(['甲']), excludeFilter: '过期' })).toBeUndefined();
    expect(landingNodeNames({ nodeSet: landing })).toBeUndefined();
  });
  it('弱提示区分自动、精确与已有正则，全部范围不暴露勾选生成的正则', () => {
    expect(viaConstraintHint('全部引用来源', { regex: '' })).toContain('沿用已有规则');
    expect(viaConstraintHint('全部引用来源', { exact: '' })).toContain('尚未选择');
    expect(viaConstraintHint('全部引用来源', { exact: 'GCP' })).toContain('精确匹配');
    expect(viaConstraintHint('全部引用来源', { regex: '香港' })).toContain('已有正则 香港');
    expect(landingConstraintHint('全部引用来源', { nodeSet: landing })).toContain('新增节点');
    expect(landingConstraintHint('全部引用来源', { nodeSet: landing, filter: selectedNodeFilter(['甲', '乙']) })).not.toContain('^');
    expect(landingConstraintHint('全部引用来源', { nodeSet: landing, filter: selectedNodeFilter([]) })).toContain('尚未选择');
    expect(landingConstraintHint('全部引用来源', { nodeSet: landing, filter: '香港', excludeFilter: '过期' })).toContain('排除 过期');
  });
  it('Provider 前置正则合法且整集同源必须阻止', () => {
    expect(chainInputError(chain)).toBeUndefined();
    expect(chainInputError({ ...chain, landing: { nodeSet: relay } })).toContain('循环');
    expect(chainInputError({ ...chain, via: { kind: 'node', ref: { nodeSet: relay, match: { regex: '[' } } } })).toContain('正则');
  });
  it('已保存的空正则仍可保存，未点选前置不能保存', () => {
    expect(chainInputError({ ...chain, via: { kind: 'node', ref: { nodeSet: relay, match: { regex: '' } } } })).toBeUndefined();
    expect(chainInputError({ ...chain, via: { kind: 'node', ref: { nodeSet: relay, match: { exact: '' } } } })).toContain('请选择');
  });
  it('前置、落地、回退引用都算受影响，相同 ID 不同来源不混淆', () => {
    expect(chainUsesNodeSet(chain, landing)).toBe(true);
    expect(chainUsesNodeSet(chain, relay)).toBe(true);
    expect(chainUsesNodeSet(chain, { ...relay, type: 'source' })).toBe(false);
    const via: Target = { kind: 'node', ref: { nodeSet: landing, match: { exact: '旧节点' }, fallback: chain.via } };
    expect(chainUsesNodeSet({ ...chain, via }, relay)).toBe(true);
  });
  it('全部来源的链在移出单个节点集后保留，继续动态选择剩余来源', () => {
    const all: ChainRule = { id: 'all', landing: { nodeSet: { type: 'all', id: 'inline' } }, via: { kind: 'node', ref: { nodeSet: { type: 'all', id: 'provider' }, match: { regex: '' } } } };
    expect(chainInputError(all)).toBeUndefined();
    expect(chainInputError({ ...all, landing: { nodeSet: { type: 'all', id: 'provider' } } })).toContain('循环');
    const other = { type: 'local' as const, id: 'other' };
    const profile: Profile = { id: 'p', name: '全部', nodeSets: [{ ref: landing, output: 'inline' }, { ref: relay, output: 'provider' }, { ref: other, output: 'provider' }], chains: [all], overlay: {}, refPolicy: { default: 'wrap' } };
    expect(removeProfileNodeSet(profile, relay).next.chains).toEqual([all]);
    expect(removeProfileNodeSet(removeProfileNodeSet(profile, relay).next, other).chains).toEqual([all]);
  });
  it('确认移出时原子删除对应链，保留其他链及节点源文档', () => {
    const unaffected = { ...chain, id: 'keep', via: { kind: 'group' as const, groupId: 'g' } };
    const profile: Profile = { id: 'p', name: '测试', overlay: {}, refPolicy: { default: 'wrap' }, nodeSets: [{ ref: landing, output: 'inline' }, { ref: relay, output: 'provider' }], chains: [chain, unaffected] };
    const next = removeProfileNodeSet(profile, relay).next;
    expect(next.nodeSets.map(s => s.ref)).toEqual([landing]);
    expect(next.chains).toEqual([unaffected]);
    expect(profile.nodeSets).toHaveLength(2);
    expect(profile.chains).toHaveLength(2);
  });
});

describe('节点来源 → 代理链 → 策略组级联清理', () => {
  const nodeMember = (nodeSet: typeof landing, exact: string): GroupMember => ({ kind: 'node', ref: { nodeSet, match: { exact }, fallback: 'error' } });
  const setMember = (ref: typeof landing): GroupMember => ({ kind: 'nodeset', ref });
  const other = { type: 'local' as const, id: 'other' };
  const base = (members: GroupMember[], chains: ChainRule[] = [chain]): Profile => ({
    id: 'p', name: '测试', overlay: {}, refPolicy: { default: 'wrap' }, chains,
    nodeSets: [{ ref: landing, output: 'inline' }, { ref: relay, output: 'provider' }, { ref: other, output: 'inline' }],
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '组', type: 'select', members }], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } },
  });
  const groupMembers = (profile: Profile) => profile.routing?.mode === 'independent' ? profile.routing.config.groups[0]!.members : [];

  it('移出来源时清除引用它的代理链、成员和规则出口', () => {
    const profile = base([setMember(relay), nodeMember(relay, '甲'), { kind: 'builtin', name: 'DIRECT' }]);
    const routing = profile.routing;
    if (routing?.mode !== 'independent') throw new Error('测试数据错误');
    routing.config.rules = [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'a.test' } }, target: nodeMember(relay, '甲') as Target }];
    const cascade = removeProfileNodeSet(profile, relay);
    expect(cascade.chains).toEqual([chain]);
    expect(cascade.members).toHaveLength(2);
    expect(cascade.rules).toBe(1);
    expect(groupMembers(cascade.next)).toEqual([{ kind: 'builtin', name: 'DIRECT' }]);
    expect(cascade.next.routing).toMatchObject({ config: { rules: [{ target: { kind: 'builtin', name: 'REJECT' } }] } });
    expect(groupMembers(profile)).toHaveLength(3);
  });
  it('移出前置来源时，代理链被清除并继续清除只靠它的落地成员', () => {
    const cascade = removeProfileNodeSet(base([setMember(landing), setMember(other)]), relay);
    expect(cascade.chains).toEqual([chain]);
    expect(groupMembers(cascade.next)).toEqual([setMember(other)]);
  });
  it('删除代理链清除经过它的成员，无关成员与其他链仍覆盖的成员保留', () => {
    const second: ChainRule = { ...chain, id: 'second' };
    const profile = base([setMember(landing), setMember(other), { kind: 'all', scope: 'all' }]);
    const removed = planProfileChange(profile, { chains: [] });
    expect(removed.members.map(item => item.member)).toEqual([setMember(landing)]);
    expect(removed.chains).toEqual([]);
    expect(hasCascade(planProfileChange(base([setMember(landing)], [chain, second]), { chains: [second] }))).toBe(false);
  });
  it('只改前置不影响成员；落地范围收窄只清除离开范围的单节点', () => {
    const profile = base([nodeMember(landing, '甲'), nodeMember(landing, '乙'), setMember(landing)]);
    expect(hasCascade(planProfileChange(profile, { chains: [{ ...chain, via: { kind: 'group', groupId: 'g' } }] }))).toBe(false);
    const narrowed = planProfileChange(profile, { chains: [{ ...chain, landing: { nodeSet: landing, filter: selectedNodeFilter(['甲']) } }] });
    expect(narrowed.members.map(item => item.member)).toEqual([nodeMember(landing, '乙')]);
    expect(groupMembers(narrowed.next)).toEqual([nodeMember(landing, '甲'), setMember(landing)]);
  });
  it('切换输出方式只影响「全部」范围：范围变空清除代理链，离开范围清除成员', () => {
    const all: ChainRule = { id: 'all', landing: { nodeSet: { type: 'all', id: 'provider' } }, via: { kind: 'group', groupId: 'g' } };
    const profile = base([setMember(relay)], [all]);
    const toInline = profile.nodeSets.map(s => ({ ...s, output: 'inline' as const }));
    const cascade = planProfileChange(profile, { nodeSets: toInline });
    expect(cascade.chains).toEqual([all]);
    expect(cascade.members.map(item => item.member)).toEqual([setMember(relay)]);
    expect(hasCascade(planProfileChange(base([setMember(relay)]), { nodeSets: toInline }))).toBe(false);
  });
  it('来源由展开改为引用时，指向它的规则出口改为 REJECT；已是引用的历史出口不计入', () => {
    const node = (nodeSet: typeof relay): Target => ({ kind: 'node', ref: { nodeSet, match: { exact: '甲' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
    const profile: Profile = { ...base([]), nodeSets: [{ ref: relay, output: 'inline' }, { ref: other, output: 'provider' }], routing: { mode: 'independent', config: { groups: [], rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'a.test' } }, target: node(relay) }], final: node(other) } } };
    const cascade = planProfileChange(profile, { nodeSets: profile.nodeSets.map(s => ({ ...s, output: 'provider' as const })) });
    expect(cascade.rules).toBe(1);
    const config = (cascade.next.routing as Extract<Profile['routing'], { mode: 'independent' }>).config;
    expect(config.rules[0]!.target).toEqual({ kind: 'builtin', name: 'REJECT' });
    expect(config.final).toEqual(node(other));
    expect(hasCascade(planProfileChange(profile, { nodeSets: profile.nodeSets }))).toBe(false);
  });
  it('绑定模板时只清理追加成员与独立组，清空的追加项被移除', () => {
    const profile: Profile = { ...base([]), routing: { mode: 'bound', templateId: 't', groupAdditions: { tpl: [setMember(relay)], keep: [setMember(other)] }, extraGroups: [{ id: 'x', name: '独立', type: 'select', members: [nodeMember(relay, '甲')] }] } };
    const cascade = removeProfileNodeSet(profile, relay);
    expect(cascade.members.map(item => item.groupId)).toEqual(['tpl', 'x']);
    expect(cascade.next.routing).toMatchObject({ groupAdditions: { keep: [setMember(other)] }, extraGroups: [{ id: 'x', members: [] }] });
    expect((cascade.next.routing as { groupAdditions: object }).groupAdditions).not.toHaveProperty('tpl');
  });
  it('没有下游内容时不提示；提示正文逐项列出', () => {
    expect(hasCascade(planProfileChange(base([]), { nodeSets: base([]).nodeSets }))).toBe(false);
    const cascade = removeProfileNodeSet(base([setMember(relay)]), relay);
    const text = cascadeDescription(cascade, '将一起清除。', { chain: () => '前置 → 落地', member: item => `${item.groupId}：来源` });
    expect(text).toContain('代理链（1 条）\n前置 → 落地');
    expect(text).toContain('策略组成员（1 项）\ng：来源');
    expect(text).toContain('保存订阅后生效。');
  });
});
