import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { TemplateTargetSelect } from './TemplateFields.tsx';
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
  it('只读列表不能新增、删除、排序或改变隐藏状态，但可打开节点填充入口', () => {
    const html = renderToStaticMarkup(<TemplateGroupsEditor {...common} readOnly memberSummary={() => '本订阅的节点集'} />);
    expect(html).toContain('编辑策略组「节点选择」');
    expect(html).toContain('本订阅的节点集');
    expect(html).not.toContain('新建策略组');
    expect(html).not.toContain('删除策略组');
    expect(html.match(/<button[^>]*role="radio"[^>]*\sdisabled=""/g)).toHaveLength(2);
    expect(html).not.toContain('更多操作');
    expect(html).not.toContain('aria-label="拖动');
  });
  it('模板和独立订阅保留结构编辑能力', () => {
    const html = renderToStaticMarkup(<TemplateGroupsEditor {...common} />);
    expect(html).toContain('新建策略组');
    expect(html).toContain('删除策略组「节点选择」');
    expect(html).toContain('aria-label="策略组「节点选择」的显示状态"');
    expect(html).toMatch(/aria-checked="true"[^>]*>显示</);
    expect(html).toContain('aria-label="拖动');
  });
  it('绑定订阅的模板组可切换隐藏，只有与模板不同时才标记', () => {
    const group = common.value.groups[0]!;
    const list = (hidden: boolean, inherited: boolean) => renderToStaticMarkup(<TemplateGroupsEditor {...common} value={{ ...common.value, groups: [{ ...group, display: { hidden } }] }} isGroupReadOnly={() => true} hiddenOverride={{ inherited: () => inherited, set: () => {} }} />);
    expect(list(true, false)).toContain('模板为显示');
    expect(list(true, false)).toMatch(/aria-checked="true"[^>]*>隐藏</);
    expect(list(false, true)).toMatch(/aria-checked="true"[^>]*>显示</);
    expect(list(false, true)).toContain('模板为隐藏');
    expect(list(true, true)).not.toContain('模板为');
    expect(list(true, false)).not.toMatch(/<button[^>]*role="radio"[^>]*\sdisabled=""/);
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
    expect(html).toContain('添加规则');
    expect(html).toContain('编辑第 1 项规则');
    expect(html).not.toContain('引用规则');
    expect(html).not.toContain('引用远程链接');
    expect(html).not.toContain('MATCH');
  });
  it('规则出口与 MATCH 保留行内下拉选择', () => {
    const html = rules();
    expect(html).toContain('aria-label="第 1 项规则出口"');
    expect(html).toContain('aria-label="MATCH 出口"');
    expect(html).not.toContain('编辑 MATCH');
    const locked = rules({ readOnly: true });
    expect(locked).not.toContain('aria-label="第 1 条规则出口"');
    expect(locked).not.toContain('aria-label="MATCH 出口"');
  });
  it('规则弹窗的出口是整行表单下拉，列表行内保持定宽菜单', () => {
    const select = (field: boolean) => renderToStaticMarkup(<TemplateTargetSelect field={field} id="target" label="规则出口" value={value.final} groups={value.groups} onChange={() => {}} />);
    expect(select(true)).toContain('w-full');
    expect(select(true)).toContain('id="target"');
    expect(select(true)).not.toContain('w-[84px]');
    expect(select(false)).toContain('w-[84px]');
  });
  it('编辑规则可切换匹配类型，添加时类型由入口固定', () => {
    const editor = (fixedKind: boolean) => renderToStaticMarkup(<MemoryRouter><QueryClientProvider client={new QueryClient()}><MatcherEditor fixedKind={fixedKind} value={{ kind: 'local', content: '' }} rulesets={[]} onChange={() => {}} /></QueryClientProvider></MemoryRouter>);
    expect(editor(false)).toContain('匹配类型');
    expect(editor(true)).not.toContain('匹配类型');
  });
});
