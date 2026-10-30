import { describe, expect, it } from 'vitest';
import { flattenTemplateItems, templateListItems } from './TemplateBoundList.tsx';

describe('模板整体排序', () => {
  it('跨越整个模板移动，自定义项不能落进模板内部', () => {
    const items = ['a', 't1', 't2', 'b', 'c'].map(id => ({ id }));
    const rows = templateListItems(items, ['t1', 't2'], 1);
    expect(rows).toHaveLength(4);
    const reordered = [rows[2]!, rows[0]!, rows[1]!, rows[3]!];
    const result = flattenTemplateItems(reordered);
    expect(result.items.map(item => item.id)).toEqual(['b', 'a', 't1', 't2', 'c']);
    expect(result.templateStart).toBe(2);
  });
  it('空模板仍占据排序位置，更新后自动在前后自定义项之间展开', () => {
    const rows = templateListItems([{ id: 'a' }, { id: 'b' }], [], 1);
    expect(rows[1]).toEqual({ kind: 'template', items: [] });
    const { items, templateStart } = flattenTemplateItems([rows[1]!, rows[0]!, rows[2]!]);
    expect(templateStart).toBe(0);
    expect(flattenTemplateItems(templateListItems([{ id: 'new-template' }, ...items], ['new-template'], templateStart)).items.map(item => item.id)).toEqual(['new-template', 'a', 'b']);
  });
});
