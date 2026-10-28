import type { GroupSpec, Overlay } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import type { TemplateDoc } from '../../hooks.ts';
import { effectiveGroups } from './context.ts';
import { reorderExtraGroups } from './groupOrder.ts';

const group = (id: string): GroupSpec => ({ id, name: id, type: 'select', members: [], extra: { custom: { keep: true } } });
const template = (ids: string[]): TemplateDoc => ({ id: 'template', version: 1, groups: ids.map(group), rules: [], final: { kind: 'builtin', name: 'DIRECT' } });

describe('私有组顺序与锚点换算', () => {
  it.each([
    { name: '相邻私有组', order: ['t1', 'p2', 'p1', 't2', 'p3'], anchors: ['t1', 'p2', 't2'] },
    { name: '私有组全部在末尾', order: ['t1', 't2', 'p3', 'p1', 'p2'], anchors: ['t2', 'p3', 'p1'] },
    { name: '私有组夹在模板组之间', order: ['t1', 'p1', 't2', 'p2', 'p3'], anchors: ['t1', 't2', 'p2'] },
    { name: '私有组连续链式锚定', order: ['t1', 'p3', 'p2', 'p1', 't2'], anchors: ['t1', 'p3', 'p2'] },
  ])('$name：往返保持目标顺序与组内容', ({ order, anchors }) => {
    const extras = ['p1', 'p2', 'p3'].map((id) => ({ after: 't1', group: group(id) }));
    const original = structuredClone(extras);
    const result = reorderExtraGroups(['t1', 't2'], order, extras);
    expect(result.map((entry) => entry.after)).toEqual(anchors);
    expect(result.map((entry) => entry.group.id)).toEqual(order.filter((id) => id.startsWith('p')));
    expect(effectiveGroups(template(['t1', 't2']), { extraGroups: result }).map((g) => g.id)).toEqual(order);
    for (const entry of result) expect(entry.group).toBe(extras.find((item) => item.group.id === entry.group.id)!.group);
    expect(extras).toEqual(original);
  });

  it('无模板时允许首位私有组，并清除旧锚点', () => {
    const extras = ['p1', 'p2'].map((id) => ({ after: 'missing', group: group(id) }));
    const result = reorderExtraGroups([], ['p2', 'p1'], extras);
    expect(result.map((entry) => entry.after)).toEqual([undefined, 'p2']);
    expect(effectiveGroups(undefined, { extraGroups: result }).map((g) => g.id)).toEqual(['p2', 'p1']);
  });

  it('删除链中私有组后重算，后继组仍留在原位置', () => {
    const extras: NonNullable<Overlay['extraGroups']> = [
      { after: 't1', group: group('p1') }, { after: 'p1', group: group('p2') },
    ];
    const result = reorderExtraGroups(['t1', 't2'], ['t1', 'p2', 't2'], extras.filter((entry) => entry.group.id !== 'p1'));
    expect(effectiveGroups(template(['t1', 't2']), { extraGroups: result }).map((g) => g.id)).toEqual(['t1', 'p2', 't2']);
  });

  it('空列表和仅模板组无需私有锚点', () => {
    expect(reorderExtraGroups([], [], [])).toEqual([]);
    expect(reorderExtraGroups(['t1'], ['t1'], [])).toEqual([]);
  });

  it('拒绝首位私有组、模板乱序及不完整或重复的目标列表', () => {
    const extras = [{ group: group('p1') }];
    expect(() => reorderExtraGroups(['t1', 't2'], ['p1', 't1', 't2'], extras)).toThrow('第一个模板组');
    expect(() => reorderExtraGroups(['t1', 't2'], ['t2', 'p1', 't1'], extras)).toThrow('模板组之间的顺序');
    for (const order of [['t1'], ['t1', 'p1', 'p1'], ['t1', 't2', 'unknown']]) {
      expect(() => reorderExtraGroups(['t1', 't2'], order, extras)).toThrow('恰好包含');
    }
  });
});
