import { describe, expect, it } from 'vitest';
import { Report, resolveProfileRouting, withGroupHidden } from '../src/index.ts';
import type { Profile, Template } from '../src/types.ts';
import { render, TEMPLATE } from './fixtures/scenarios.ts';

type Bound = Extract<NonNullable<Profile['routing']>, { mode: 'bound' }>;
const template: Template = { ...TEMPLATE, groups: [
  { id: 'shown', name: '显示组', type: 'select', members: [] },
  { id: 'hidden', name: '隐藏组', type: 'select', members: [], display: { hidden: true, icon: 'https://example.test/a.png' } },
], rules: [], final: { kind: 'builtin', name: 'DIRECT' } };
const bound = (groupHidden?: Record<string, boolean>): Bound => ({ mode: 'bound', templateId: template.id, groupAdditions: {}, ...(groupHidden ? { groupHidden } : {}) });
const display = (routing: Bound) => {
  const report = new Report();
  const groups = resolveProfileRouting({ routing, overlay: {} }, template, report).groups;
  return { report, shown: groups.find(g => g.id === 'shown')!.display, hidden: groups.find(g => g.id === 'hidden')!.display };
};

describe('绑定订阅的模板组隐藏覆盖', () => {
  it('没有记录时跟随模板', () => {
    const result = display(bound());
    expect(result.shown?.hidden).toBeUndefined();
    expect(result.hidden?.hidden).toBe(true);
  });

  it('覆盖两个方向且不丢失其他展示参数，也不产生覆盖层错误', () => {
    const result = display(bound({ shown: true, hidden: false }));
    expect(result.shown?.hidden).toBe(true);
    expect(result.hidden).toEqual({ hidden: false, icon: 'https://example.test/a.png' });
    expect(result.report.items).toEqual([]);
  });

  it('只保存与模板不同的值，切回即恢复跟随并清理已删除组', () => {
    const on = withGroupHidden(bound({ gone: true }), template, 'shown', true);
    expect(on.groupHidden).toEqual({ shown: true });
    expect('groupHidden' in withGroupHidden(on, template, 'shown', false)).toBe(false);
    expect(withGroupHidden(bound(), template, 'hidden', true).groupHidden).toBeUndefined();
    expect(withGroupHidden(bound(), template, 'hidden', false).groupHidden).toEqual({ hidden: false });
  });

  it('已删除组的记录只告警', () => {
    const { report } = display(bound({ gone: true }));
    expect(report.hasErrors).toBe(false);
    expect(report.items.map(item => item.code)).toEqual(['binding.orphan']);
  });

  it('覆盖写入渲染结果', () => {
    const output = render({ routing: { mode: 'bound', templateId: TEMPLATE.id, groupAdditions: {}, groupHidden: { sel: true } } });
    expect((output.config['proxy-groups'] as { name: string; hidden?: boolean }[]).find(g => g.name === '🚀 节点选择')?.hidden).toBe(true);
  });
});
