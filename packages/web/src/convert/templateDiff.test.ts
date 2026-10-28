import { describe, expect, it } from 'vitest';
import { templateDiff } from './templateDiff.ts';
import type { TemplateBody } from './templateYaml.ts';

const direct = { kind: 'builtin', name: 'DIRECT' } as const;
const reject = { kind: 'builtin', name: 'REJECT' } as const;
const fixture = (): TemplateBody => ({
  groups: [{ id: 'g1', name: '选择', type: 'select', members: [direct], test: { interval: 300 } }, { id: 'g2', name: '测速', type: 'url-test', members: [] }],
  rules: ['r1', 'r2', 'r3'].map((id) => ({ id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: `${id}.example` } }, target: direct })),
  final: direct,
});

describe('模板版本对比', () => {
  it('新增组和规则，不把后续条目的位置偏移误判成移动', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.groups.unshift({ id: 'g0', name: '新增', type: 'select', members: [] });
    after.rules.unshift({ ...before.rules[0]!, id: 'r0' });
    const diff = templateDiff(before, after);
    expect(diff.groups.added.map((g) => g.id)).toEqual(['g0']);
    expect(diff.rules.added.map((r) => r.id)).toEqual(['r0']);
    expect(diff.groups.modified).toEqual([]);
    expect(diff.rules.modified).toEqual([]);
    expect(diff.rules.moved).toEqual([]);
  });

  it('删除组和规则', () => {
    const before = fixture();
    const after = { ...before, groups: before.groups.slice(1), rules: before.rules.slice(1) };
    const diff = templateDiff(before, after);
    expect(diff.groups.removed.map((g) => g.id)).toEqual(['g1']);
    expect(diff.rules.removed.map((r) => r.id)).toEqual(['r1']);
    expect(diff.rules.moved).toEqual([]);
  });

  it('改名保留 ID，列出嵌套字段、成员、规则与 final 的新旧值', () => {
    const before = fixture();
    const after = structuredClone(before);
    Object.assign(after.groups[0]!, { name: '改名', members: [reject], test: { interval: 600 } });
    after.rules[0]!.enabled = false;
    after.rules[0]!.target = reject;
    after.final = reject;
    const diff = templateDiff(before, after);
    expect(diff.groups.added).toEqual([]);
    expect(diff.groups.removed).toEqual([]);
    expect(diff.groups.modified[0]).toMatchObject({ id: 'g1', fields: [
      { field: 'name', before: '选择', after: '改名' },
      { field: 'members', before: [direct], after: [reject] },
      { field: 'test.interval', before: 300, after: 600 },
    ] });
    expect(diff.rules.modified[0]!.fields).toEqual([
      { field: 'target.name', before: 'DIRECT', after: 'REJECT' },
      { field: 'enabled', before: undefined, after: false },
    ]);
    expect(diff.final).toEqual({ before: direct, after: reject });
    expect(before.groups[0]!.name).toBe('选择');
  });

  it('仅移动顺序，不报告字段修改或增删', () => {
    const before = fixture();
    const after = { ...before, groups: [...before.groups].reverse(), rules: [...before.rules].reverse() };
    const diff = templateDiff(before, after);
    expect(diff.rules.moved).toEqual([{ id: 'r3', before: 2, after: 0 }, { id: 'r1', before: 0, after: 2 }]);
    expect(diff.groups.moved).toHaveLength(2);
    expect(diff.rules.modified).toEqual([]);
    expect(diff.groups.modified).toEqual([]);
    expect(diff.rules.added).toEqual([]);
    expect(diff.rules.removed).toEqual([]);
    expect(diff.final).toBeUndefined();
  });

  it('对象键顺序变化不算修改，成员顺序变化算修改', () => {
    const before = fixture();
    before.groups[0]!.extra = { a: 1, b: 2 };
    before.groups[0]!.members = [direct, reject];
    const after = structuredClone(before);
    after.groups[0]!.extra = { b: 2, a: 1 };
    expect(templateDiff(before, after).groups.modified).toEqual([]);
    after.groups[0]!.members.reverse();
    expect(templateDiff(before, after).groups.modified[0]!.fields.map((f) => f.field)).toEqual(['members']);
  });
});
