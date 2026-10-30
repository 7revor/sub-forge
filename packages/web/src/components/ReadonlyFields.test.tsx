import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupSettingsFields } from './GroupSettingsFields.tsx';
import { Select, Switch } from './ui.tsx';

describe('只读控件与空值提示', () => {
  it('模板类型和 lazy 明确禁用，同时保留真实测速值', () => {
    const html = renderToStaticMarkup(<GroupSettingsFields disabled value={{ type: 'fallback', test: { url: 'https://example.test/ping', interval: 300, lazy: false } }} onChange={() => {}} />);
    const selects = html.match(/<button[^>]*role="combobox"[^>]*>/g) ?? [];
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select).toContain('disabled=""');
    expect(html).toContain('value="https://example.test/ping"');
    expect(html).toContain('value="300"');
    expect(html).toContain('>关<');
  });
  it('未配置参数只有提示，不填充示例默认值', () => {
    const html = renderToStaticMarkup(<GroupSettingsFields disabled value={{ type: 'fallback' }} onChange={() => {}} />);
    expect(html).toContain('模板未配置');
    expect(html).not.toContain('value="300"');
    expect(html).toContain('data-placeholder=""');
  });
  it('空选择显示真正占位提示，且不需要空选项', () => {
    const html = renderToStaticMarkup(<Select value="" placeholder="选择用于订阅的规则模板"><option value="t">精简</option></Select>);
    expect(html).toContain('data-placeholder=""');
    expect(html).toContain('选择用于订阅的规则模板');
  });
  it('只读开关保留开关语义和当前值', () => {
    const html = renderToStaticMarkup(<Switch label="隐藏" checked disabled onChange={() => {}} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-checked="true"');
  });
});
