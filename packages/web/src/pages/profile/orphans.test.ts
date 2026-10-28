import type { GroupSpec, Overlay, RuleEntry, Template } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { findOverlayOrphans } from './orphans.ts';

const group = (id: string): GroupSpec => ({ id, name: id, type: 'select', members: [] });
const rule = (id: string): RuleEntry => ({ id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.com' } }, target: { kind: 'builtin', name: 'DIRECT' } });
const template: Pick<Template, 'groups' | 'rules'> = { groups: [group('g')], rules: [rule('r')] };

describe('更换模板的孤儿计算', () => {
  it('组覆盖只匹配新模板的组 ID', () => {
    expect(findOverlayOrphans({ groupPatches: { g: {}, removed: {} } }, template).groupPatches).toEqual(['removed']);
  });

  it('规则覆盖只匹配新模板的规则 ID', () => {
    expect(findOverlayOrphans({ rulePatches: { r: { enabled: false }, removed: {} } }, template).rulePatches).toEqual(['removed']);
  });

  it('私有组的丢失锚点计为孤儿，已有私有组锚点和无锚点有效', () => {
    const overlay: Overlay = { extraGroups: [
      { after: 'g', group: group('p1') }, { after: 'p1', group: group('p2') },
      { after: 'removed', group: group('p3') }, { after: 'p3', group: group('p4') }, { group: group('p5') },
    ] };
    expect(findOverlayOrphans(overlay, template).extraGroups).toEqual(['p3']);
  });

  it('私有规则检查前后锚点，top / bottom 和有效的私有规则锚点保留', () => {
    const overlay: Overlay = { extraRules: [
      { anchor: { before: 'r' }, rule: rule('p1') }, { anchor: { after: 'p1' }, rule: rule('p2') },
      { anchor: { before: 'removed' }, rule: rule('p3') }, { anchor: { after: 'removed' }, rule: rule('p4') },
      { anchor: 'top', rule: rule('p5') }, { anchor: 'bottom', rule: rule('p6') },
    ] };
    expect(findOverlayOrphans(overlay, template).extraRules).toEqual(['p3', 'p4']);
  });

  it('规则锚定于未输出的孤儿规则或后续规则时同样是孤儿', () => {
    const overlay: Overlay = { extraRules: [
      { anchor: { after: 'removed' }, rule: rule('p1') }, { anchor: { after: 'p1' }, rule: rule('p2') },
      { anchor: { before: 'p4' }, rule: rule('p3') }, { anchor: 'bottom', rule: rule('p4') },
    ] };
    expect(findOverlayOrphans(overlay, template).extraRules).toEqual(['p1', 'p2', 'p3']);
  });

  it('不使用模板时保留输入，区分覆盖项与私有锚点', () => {
    const overlay: Overlay = {
      groupPatches: { g: {} }, rulePatches: { r: {} },
      extraGroups: [{ after: 'g', group: group('p1') }],
      extraRules: [{ anchor: { after: 'r' }, rule: rule('p2') }],
    };
    const original = structuredClone(overlay);
    expect(findOverlayOrphans(overlay)).toEqual({ groupPatches: ['g'], rulePatches: ['r'], extraGroups: ['p1'], extraRules: ['p2'] });
    expect(overlay).toEqual(original);
    expect(findOverlayOrphans({})).toEqual({ groupPatches: [], rulePatches: [], extraGroups: [], extraRules: [] });
  });
});
