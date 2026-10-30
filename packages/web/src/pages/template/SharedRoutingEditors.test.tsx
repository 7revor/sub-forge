import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { TemplateGroupsEditor } from './TemplateGroupsEditor.tsx';
import { TemplateRulesEditor } from './TemplateRulesEditor.tsx';

const value: TemplateBody = {
  groups: [{ id: 'g', name: '节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }],
  rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.test' } }, target: { kind: 'group', groupId: 'g' } }],
  final: { kind: 'group', groupId: 'g' },
};
const common = { value, onChange: () => {}, selected: undefined, onSelect: () => {}, report: [] };
function rules(props: Partial<Parameters<typeof TemplateRulesEditor>[0]> = {}) {
  return renderToStaticMarkup(<MemoryRouter><QueryClientProvider client={new QueryClient()}><TemplateRulesEditor {...common} ctx={{ rulesets: [] }} onRuleValidationReady={() => {}} {...props} /></QueryClientProvider></MemoryRouter>);
}

describe('模板与订阅共享编辑器的权限边界', () => {
  it('绑定组不能新增、删除、排序或改变隐藏状态，但可打开节点填充入口', () => {
    const html = renderToStaticMarkup(<TemplateGroupsEditor {...common} readOnly memberSummary={() => '本订阅的节点集'} />);
    expect(html).toContain('编辑策略组「节点选择」');
    expect(html).toContain('本订阅的节点集');
    expect(html).not.toContain('新增组');
    expect(html).not.toContain('删除策略组');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('aria-label="拖动');
  });
  it('模板和独立订阅保留结构编辑能力', () => {
    const html = renderToStaticMarkup(<TemplateGroupsEditor {...common} />);
    expect(html).toContain('新增组');
    expect(html).toContain('删除策略组');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="拖动');
  });
  it('绑定规则仍可查看内容，但不能编辑、删除、排序或修改 MATCH', () => {
    const html = rules({ readOnly: true });
    expect(html).toContain('预览第 1 项规则');
    expect(html).toContain('DOMAIN,example.test');
    expect(html).toContain('MATCH');
    for (const label of ['添加本地规则', '编辑第 1 项规则', '删除第 1 项规则', '编辑 MATCH', 'aria-label="拖动']) expect(html).not.toContain(label);
  });
  it('前置规则只开放本地规则，不能改变模板 MATCH', () => {
    const html = rules({ hideFinal: true, staticOnly: true });
    expect(html).toContain('添加本地规则');
    expect(html).toContain('编辑第 1 项规则');
    expect(html).not.toContain('引用规则');
    expect(html).not.toContain('引用远程链接');
    expect(html).not.toContain('MATCH');
  });
  it('规则出口与 MATCH 直接提供下拉选择，编辑弹窗不承担出口设置', () => {
    const html = rules();
    expect(html).toContain('aria-label="第 1 项规则出口"');
    expect(html).toContain('aria-label="MATCH 出口"');
    expect(html).not.toContain('编辑 MATCH');
    const locked = rules({ readOnly: true });
    expect(locked).not.toContain('aria-label="第 1 条规则出口"');
    expect(locked).not.toContain('aria-label="MATCH 出口"');
  });
});
