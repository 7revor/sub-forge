import { surgeBaseGroups } from '../schemas/surgeBase.ts';
import { loonBaseGroups } from '../schemas/loonBase.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mihomoBaseGroups } from '../schemas/mihomoBase.ts';
import { stashBaseGroups } from '../schemas/stashBase.ts';
import { PROXY_TYPES, schemaFor } from '../schemas/proxy.ts';
import { FieldInput } from './SchemaForm.tsx';
import { OverrideForm } from './OverrideField.tsx';
import { Select, type SelectProps } from './listbox.tsx';
import { setPath, type FieldSpec } from './schema.ts';

describe('表单占位与空值契约', () => {
  it('继承预设的空字符串、空列表和空对象显示提示，保留 false 与零', () => {
    const field: FieldSpec = { key: 'value', label: '测试字段', type: 'string', placeholder: '字段用途说明' };
    const render = (value: unknown) => renderToStaticMarkup(<OverrideForm groups={[{ title: '测试', fields: [field] }]} base={{ value }} patch={{}} onChange={() => {}} />);
    for (const value of [undefined, null, '', [], {}]) expect(render(value)).toContain('字段用途说明');
    for (const value of [false, 0]) {
      expect(render(value)).not.toContain('字段用途说明');
      expect(render(value)).toContain(`>${value}<`);
    }
  });

  it('所有基础设置和节点协议字段都提供中文解释', () => {
    const groups = [...mihomoBaseGroups, ...stashBaseGroups, ...surgeBaseGroups, ...loonBaseGroups, ...PROXY_TYPES.flatMap(({ value }) => schemaFor(value))];
    for (const field of groups.flatMap(group => group.fields)) {
      expect(field.placeholder, field.key).toMatch(/[\u4e00-\u9fff]/);
      expect(field.placeholder, field.key).not.toMatch(/^(未设置|不设置|请选择)$/);
    }
  });

  it('旧的空 option 不覆盖 placeholder；数值零仍是有效选项', () => {
    const options = <><option value="">旧空项</option><option value="0">零</option></>;
    const empty = renderToStaticMarkup(<Select placeholder="选择检测间隔" value="" clearable>{options}</Select>);
    expect(empty).toContain('选择检测间隔');
    expect(empty).toContain('data-placeholder=');
    expect(empty).not.toContain('旧空项');
    expect(empty).not.toContain('aria-label="清空');
    const zero = renderToStaticMarkup(<Select placeholder="选择检测间隔" value={0} clearable>{options}</Select>);
    expect(zero).toContain('>零<');
    expect(zero).not.toContain('data-placeholder=');
    expect(zero).toContain('aria-label="清空');
  });

  it('显式 false 与未配置区分，清空时删除字段及空父对象', () => {
    const field: FieldSpec = { key: 'dns.enable', label: 'DNS', type: 'bool', placeholder: '是否启用内置 DNS' };
    let config: Record<string, unknown> = {};
    const input = FieldInput({ field, id: 'dns', value: undefined, onChange: next => { config = setPath(config, field.key, next); } });
    const onChange = (input.props as SelectProps).onChange!;
    onChange({ target: { value: 'false' } });
    expect(config).toEqual({ dns: { enable: false } });
    const html = renderToStaticMarkup(<FieldInput field={field} id="dns" value={false} onChange={() => {}} />);
    expect(html).toContain('>关闭<');
    expect(html).not.toContain('data-placeholder=');
    onChange({ target: { value: '' } });
    expect(config).toEqual({});
    expect(JSON.stringify(config)).not.toContain(field.placeholder);
  });
});
