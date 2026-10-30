import { describe, expect, it } from 'vitest';
import type { Collection } from '@sub-forge/core';
import { trafficSourceIds } from './traffic.ts';

const nodeSets = [{ ref: { type: 'collection' as const, id: 'outer' }, output: 'provider' as const }];
const collections: Collection[] = [
  { id: 'outer', name: '外层', pipeline: [], members: [{ ref: { type: 'source', id: 'a' } }, { ref: { type: 'collection', id: 'inner' } }] },
  { id: 'inner', name: '内层', pipeline: [], members: [{ ref: { type: 'source', id: 'a' } }, { ref: { type: 'source', id: 'b' } }, { ref: { type: 'collection', id: 'outer' } }] },
];
describe('流量来源旧设置兼容', () => {
  it('旧汇总展开嵌套组合并去重，循环引用不阻塞回显', () => {
    expect(trafficSourceIds({ nodeSets }, collections)).toEqual(['a', 'b']);
    expect(trafficSourceIds({ nodeSets, userinfo: { mode: 'sum' } }, collections)).toEqual(['a', 'b']);
  });
  it('单选、停用和显式空选不被默认汇总替换', () => {
    expect(trafficSourceIds({ nodeSets, userinfo: { mode: 'source', sourceId: 'b' } }, collections)).toEqual(['b']);
    expect(trafficSourceIds({ nodeSets, userinfo: { mode: 'none' } }, collections)).toEqual([]);
    expect(trafficSourceIds({ nodeSets, userinfo: { mode: 'sources', sourceIds: [] } }, collections)).toEqual([]);
    expect(trafficSourceIds({ nodeSets, userinfo: { mode: 'sources', sourceIds: ['c', 'b'] } }, collections)).toEqual(['c', 'b']);
  });
});
