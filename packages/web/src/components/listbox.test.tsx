import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AsyncSelect, Select } from './listbox.tsx';

describe('选择器的未选中状态', () => {
  it('禁用的空选项只作为 placeholder，不能作为已选值', () => {
    const html = renderToStaticMarkup(<Select aria-label="出口" value=""><option value="" disabled>请选择出口</option><option value="DIRECT">DIRECT</option></Select>);
    expect(html).toContain('data-placeholder=""');
    expect(html).toContain('请选择出口');
  });
  it('不限等可选空值仍是有效选项', () => {
    const html = renderToStaticMarkup(<Select aria-label="平台" value=""><option value="">不限</option><option value="ios">iOS</option></Select>);
    expect(html).not.toContain('data-placeholder=""');
    expect(html).toContain('不限');
  });
  it('异步选择器没有值时使用 placeholder，有值时显示实际名称', () => {
    const loadOptions = async () => ({ options: [], total: 0 });
    const common = { label: '更换规则集', placeholder: '选择规则集', loadOptions, onChange: () => {} };
    const empty = renderToStaticMarkup(<AsyncSelect {...common} />);
    expect(empty).toContain('data-placeholder=""');
    expect(empty).toContain('选择规则集');
    expect(empty).not.toContain('>更换规则集<');
    const selected = renderToStaticMarkup(<AsyncSelect {...common} valueLabel="Google.list" />);
    expect(selected).not.toContain('data-placeholder=""');
    expect(selected).toContain('Google.list');
    expect(selected).not.toContain('>选择规则集<');
  });
});
