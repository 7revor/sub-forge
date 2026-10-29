import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sub-forge/core';
import { createRegionGroups, REGION_GROUPS } from './regionGroups.ts';
import { templateFromYaml, templateToYaml } from './templateYaml.ts';

describe('地区节点快捷添加', () => {
  it('模板一次生成四个隐藏 select 组，筛选条件可发布并完整往返', () => {
    const groups = createRegionGroups([]);
    expect(groups.map(group => ({ name: group.name, filter: group.filter }))).toEqual(REGION_GROUPS);
    expect(new Set(groups.map(group => group.id)).size).toBe(4);
    for (const group of groups) expect(group).toMatchObject({ type: 'select', display: { hidden: true }, members: [] });
    const body = { groups, rules: [], final: { kind: 'builtin', name: 'DIRECT' } } as const;
    const template = { ...body, rules: [], id: 'regional', version: 1 };
    expect(validateTemplate(template).items).toEqual([]);
    expect(templateFromYaml(templateToYaml(template, { rulesets: [] }), template, { rulesets: [] })).toMatchObject({ ok: true, value: body });
  });

  it('订阅绑定所选节点集，同名组不重复、不覆盖用户配置', () => {
    const existing = [{ id: 'old', name: REGION_GROUPS[0].name, filter: '自定义' }];
    const ref = { type: 'source', id: 'flower' } as const;
    const added = createRegionGroups(existing, ref);
    expect(added).toHaveLength(3);
    for (const group of added) expect(group.members).toEqual([{ kind: 'nodeset', ref }]);
    expect(existing[0]!.filter).toBe('自定义');
    expect(createRegionGroups([...existing, ...added], ref)).toEqual([]);
  });
});
