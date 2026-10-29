import { describe, expect, it } from 'vitest';
import type { NodeBrief } from '../api.ts';
import { filterNodes, resolveRef } from './nodeMatch.ts';

const nodes: NodeBrief[] = [
  { name: 'HK-01', type: 'ss', server: 'a.example', port: 443 },
  { name: 'hk-02', type: 'Trojan', server: 'b.example', port: 443 },
  { name: 'HK-备用', type: 'vless', server: 'c.example', port: 443 },
  { name: 'JP-01', type: 'http', server: 'd.example', port: 443 },
  { name: 'HK-03', type: 'HTTP', server: 'e.example', port: 443 },
];

describe('节点过滤', () => {
  it('Mihomo 的 Shadowsocks 名称与节点的 ss 别名筛选一致', () => {
    expect(filterNodes(nodes, { excludeType: 'Shadowsocks|HTTP' })).toEqual({ nodes: [nodes[1], nodes[2]] });
  });
  it('组合保留、剔除和大小写不敏感的协议排除，并保持顺序', () => {
    expect(filterNodes(nodes, { filter: '(?i)^hk', excludeFilter: '备用', excludeType: ' SS | http ' })).toEqual({ nodes: [nodes[1]] });
  });
  it('空过滤项保留所有节点，不修改输入', () => {
    const before = structuredClone(nodes);
    expect(filterNodes(nodes, { filter: '', excludeFilter: '', excludeType: '' })).toEqual({ nodes });
    expect(nodes).toEqual(before);
  });
  it('保留和剔除正则都支持 (?i)', () => {
    expect(filterNodes(nodes, { filter: '(?i)^hk', excludeFilter: '(?i)^HK-0' })).toEqual({ nodes: [nodes[2]] });
    expect(filterNodes(nodes, { filter: '^hk' })).toEqual({ nodes: [nodes[1]] });
  });
  it.each([{ filter: '[' }, { excludeFilter: '[' }])('非法正则返回错误：%o', (filters) => {
    expect(filterNodes(nodes, filters)).toEqual({ nodes: [], error: expect.stringContaining('非法正则') });
  });
});

describe('单节点引用', () => {
  it('精确名称匹配并取第一个同名节点', () => {
    const duplicate = { ...nodes[0]!, server: 'other.example' };
    const result = resolveRef([...nodes, duplicate], { exact: 'HK-01' });
    expect(result).toEqual({ node: nodes[0], count: 2 });
    expect(result.node).toBe(nodes[0]);
    expect(resolveRef(nodes, { exact: 'hk-01' }).count).toBe(0);
    expect(resolveRef(nodes, { exact: 'HK.*' }).count).toBe(0);
  });
  it('正则支持 (?i)，按原顺序取 first 并统计全部命中', () => {
    const result = resolveRef(nodes, { regex: '(?i)^hk' });
    expect(result).toEqual({ node: nodes[0], count: 4 });
    expect(result.node).toBe(nodes[0]);
    expect(resolveRef(nodes, { regex: '^hk' })).toEqual({ node: nodes[1], count: 1 });
  });
  it('无命中和空列表没有首个节点', () => {
    expect(resolveRef(nodes, { regex: '^US' })).toEqual({ node: undefined, count: 0 });
    expect(resolveRef([], { exact: 'HK-01' })).toEqual({ node: undefined, count: 0 });
  });
  it('空正则按内核语义匹配全部节点', () => {
    expect(resolveRef(nodes, { regex: '' })).toEqual({ node: nodes[0], count: nodes.length });
  });
  it('非法正则即使列表为空也返回错误，不抛出', () => {
    expect(resolveRef([], { regex: '[' })).toEqual({ count: 0, error: expect.stringContaining('非法正则') });
  });
});
