import { describe, expect, it } from 'vitest';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { draftIssues, removeGroup } from './model.ts';

const direct = { kind: 'builtin', name: 'DIRECT' } as const;
const selected = { kind: 'group', groupId: 'g1' } as const;
const fixture = (): TemplateBody => ({
  groups: [
    { id: 'g1', name: '选择', type: 'select', members: [], whenEmpty: 'reject' },
    { id: 'g2', name: '出口', type: 'select', members: [selected, direct, selected], extra: { extension: { keep: true } } },
  ],
  rules: [
    { id: 'r1', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.com' } }, target: selected },
    { id: 'r2', matcher: { kind: 'ruleset', id: 'rs' }, target: direct, enabled: false },
    { id: 'r3', matcher: { kind: 'ruleset', id: 'b' }, target: selected, options: { noResolve: true, src: true } },
  ], final: selected,
});

describe('模板草稿', () => {
  it('两个组、多条规则的完整表单草稿无需 JSON 即可通过完整性检查', () => {
    expect(draftIssues(fixture())).toEqual([]);
  });

  it('空白单条规则、规则集都阻止发布并带可定位位置，包括禁用规则', () => {
    const body = fixture();
    body.rules[0]!.matcher = { kind: 'rule', rule: { type: 'DOMAIN', value: '  ' } };
    body.rules[1]!.matcher = { kind: 'ruleset', id: '' };
    body.rules[2]!.matcher = { kind: 'ruleset', id: '' };
    expect(draftIssues(body).map((r) => [r.level, r.where])).toEqual([
      ['error', 'rule:r1'], ['error', 'rule:r2'], ['error', 'rule:r3'],
    ]);
  });

  it('删除组时清除所有成员引用、把规则和 final 改为 REJECT，保留其他字段和稳定 ID', () => {
    const body = fixture();
    const snapshot = structuredClone(body);
    const next = removeGroup(body, 'g1');
    expect(next.groups).toEqual([{ ...body.groups[1], members: [direct] }]);
    expect(next.rules.map((r) => r.target)).toEqual([{ kind: 'builtin', name: 'REJECT' }, direct, { kind: 'builtin', name: 'REJECT' }]);
    expect(next.rules.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(next.rules[2]!.options).toEqual({ noResolve: true, src: true });
    expect(next.final).toEqual({ kind: 'builtin', name: 'REJECT' });
    expect(body).toEqual(snapshot);
  });
});
