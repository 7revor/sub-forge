import { describe, expect, it } from 'vitest';
import { otherFields, setPath } from '../components/schema.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from './mihomoBase.ts';

describe('基础设置 schema', () => {
  it('包含六个分组，复杂嗅探结构保留为其他字段', () => {
    expect(mihomoBaseGroups.map((group) => group.title)).toEqual(['通用', '外部控制', 'DNS', '嗅探', 'TUN', 'GEO 数据']);
    expect(otherFields({ sniffer: { enable: true, sniff: { TLS: { ports: [443] } } } }, mihomoBaseGroups))
      .toEqual({ sniffer: { sniff: { TLS: { ports: [443] } } } });
  });
  it('策略数组用逗号加空格显示，未编辑字段往返保留类型', () => {
    const original = { dns: { 'nameserver-policy': { a: ['1', '2'], b: ['3'], c: 'x,y', empty: [] }, unknown: true }, custom: [1] };
    expect(baseToForm(original)).toEqual({ dns: { 'nameserver-policy': { a: '1, 2', b: '3', c: 'x,y', empty: '' }, unknown: true }, custom: [1] });
    expect(baseFromForm(setPath(baseToForm(original), 'allow-lan', true), original)).toEqual({ ...original, 'allow-lan': true });
  });
  it('编辑后含逗号转换为数组，否则为字符串；支持删除策略', () => {
    const value = { dns: { 'nameserver-policy': { '+.example': '1, 2', single: 'system' } } };
    expect(baseFromForm(value, {})).toEqual({ dns: { 'nameserver-policy': { '+.example': ['1', '2'], single: 'system' } } });
    expect(baseFromForm({}, value)).toEqual({});
  });
  it('覆盖初值保留预设策略的单元素数组类型，不写入其他预设字段', () => {
    const base = { dns: { enable: true, 'nameserver-policy': { a: ['1'] } } };
    const patch = { dns: { 'nameserver-policy': { a: '1' } } };
    expect(baseFromForm(patch, {}, base)).toEqual({ dns: { 'nameserver-policy': { a: ['1'] } } });
  });
});
