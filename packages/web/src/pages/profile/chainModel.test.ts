import { describe, expect, it } from 'vitest';
import type { ChainRule, Profile, Target } from '@sub-forge/core';
import { chainUsesNodeSet, landingNodeName, removeProfileNodeSet } from './chainModel.ts';
import { chainInputError, exactNodeFilter } from './memberModel.ts';
const landing = { type: 'local' as const, id: 'landing' };
const relay = { type: 'local' as const, id: 'relay' };
const chain: ChainRule = { id: 'c', landing: { nodeSet: landing }, via: { kind: 'node', ref: { nodeSet: relay, match: { regex: '香港|HK' }, fallback: 'error' } } };
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
  it('Provider 前置正则合法且整集同源必须阻止', () => {
    expect(chainInputError(chain)).toBeUndefined();
    expect(chainInputError({ ...chain, landing: { nodeSet: relay } })).toContain('循环');
    expect(chainInputError({ ...chain, via: { kind: 'node', ref: { nodeSet: relay, match: { regex: '[' } } } })).toContain('正则');
  });
  it('前置、落地、回退引用都算受影响，相同 ID 不同来源不混淆', () => {
    expect(chainUsesNodeSet(chain, landing)).toBe(true);
    expect(chainUsesNodeSet(chain, relay)).toBe(true);
    expect(chainUsesNodeSet(chain, { ...relay, type: 'source' })).toBe(false);
    const via: Target = { kind: 'node', ref: { nodeSet: landing, match: { exact: '旧节点' }, fallback: chain.via } };
    expect(chainUsesNodeSet({ ...chain, via }, relay)).toBe(true);
  });
  it('确认移出时原子删除对应链，保留其他链及节点源文档', () => {
    const unaffected = { ...chain, id: 'keep', via: { kind: 'group' as const, groupId: 'g' } };
    const profile: Profile = { id: 'p', name: '测试', overlay: {}, refPolicy: { default: 'wrap' }, nodeSets: [{ ref: landing, output: 'inline' }, { ref: relay, output: 'provider' }], chains: [chain, unaffected] };
    const next = removeProfileNodeSet(profile, relay);
    expect(next.nodeSets.map(s => s.ref)).toEqual([landing]);
    expect(next.chains).toEqual([unaffected]);
    expect(profile.nodeSets).toHaveLength(2);
    expect(profile.chains).toHaveLength(2);
  });
});
