import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { baseFormFromYaml, baseFromYaml } from './baseYaml.ts';
import { formatLocalNodeYaml, inspectLocalNodeYaml } from './localNodeYaml.ts';
import { groupFromYaml, proxyFromPaste, proxyFormFromYaml, proxyFromYaml } from './proxyYaml.ts';
import { templateFormFromYaml, templateFromYaml, templateToYaml, type TemplateBody } from './templateYaml.ts';
import { createRegionGroups } from './regionGroups.ts';

const node = { name: '香港测试', type: 'http', server: 'example.test', port: 443, alpn: ['h2', 'http/1.1'] };
const list = '# 保留注释\n' + stringify([node]);
const ctx = { rulesets: [] };
const current: TemplateBody = { groups: [], rules: [{ id: 'rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.test' } }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' } };

describe('各处 YAML 编辑器接收带短横线的片段', () => {
  it('单节点粘贴、校验、回表单和格式化均接受单项列表，保留嵌套列表及注释', () => {
    expect(proxyFromPaste(list)).toMatchObject({ ok: true, value: node });
    expect(proxyFromYaml(list)).toEqual({ ok: true, value: node });
    expect(proxyFormFromYaml(list).value).toEqual(node);
    expect(inspectLocalNodeYaml(list)).toMatchObject({ ok: true, value: node });
    expect(parse(formatLocalNodeYaml(list))).toEqual(node);
    expect(formatLocalNodeYaml(list)).toContain('# 保留注释');
  });
  it('分组支持直接粘贴多节点列表，坏节点仍拒绝整个列表并报告原始行号', () => {
    expect(groupFromYaml(stringify([node, { ...node, name: '日本测试' }]))).toEqual({ ok: true, value: [node, { ...node, name: '日本测试' }] });
    expect(groupFromYaml('- {name: 好, type: http, server: example.test, port: 80}\n- {name: 坏, type: http, server: example.test}')).toMatchObject({ ok: false, line: 2, error: expect.stringContaining('第 2 个节点') });
    expect(inspectLocalNodeYaml(stringify([node, node]))).toMatchObject({ ok: false });
  });
  it('基础设置和预设兼容单项映射列表，不改变内部列表或放过重复键', () => {
    const value = { dns: { enable: true, nameserver: ['1.1.1.1', '8.8.8.8'] }, mode: 'rule' };
    const text = stringify([value]);
    expect(baseFromYaml(text)).toEqual({ ok: true, value });
    expect(baseFormFromYaml(text).value).toEqual(value);
    expect(baseFromYaml('- mode: rule\n  mode: global')).toMatchObject({ ok: false, line: 2 });
    expect(baseFromYaml('- mode: rule\n- mode: global')).toMatchObject({ ok: false });
  });
  it('模板支持直接粘贴四个地区组，保留已有规则及隐藏设置，筛选字段不丢失', () => {
    const groups = createRegionGroups([]);
    const document = parse(templateToYaml({ ...current, groups }, ctx));
    const text = stringify(document['proxy-groups']).split('\n').map(line => `  ${line}`).join('\n');
    const result = templateFromYaml(text, current, ctx);
    expect(result).toMatchObject({ ok: true, value: { rules: current.rules, final: current.final } });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.groups.map(group => ({ name: group.name, filter: group.filter, hidden: group.display?.hidden }))).toEqual(groups.map(group => ({ name: group.name, filter: group.filter, hidden: true })));
    expect(templateFormFromYaml(text, result.value, ctx).value).toEqual(result.value);
  });
  it('规则列表片段保留已有组，单项完整配置列表可回表单', () => {
    const groups = createRegionGroups([]);
    const body = { ...current, groups };
    expect(templateFromYaml('- DOMAIN,example.test,DIRECT\n- MATCH,DIRECT', body, ctx)).toMatchObject({ ok: true, value: { groups } });
    const text = stringify([parse(templateToYaml(body, ctx))]);
    expect(templateFromYaml(text, body, ctx)).toMatchObject({ ok: true, value: body });
    expect(templateFormFromYaml(text, body, ctx).value).toEqual(body);
  });
  it('地区组列表补入现有模板，已有组、规则与 MATCH 引用保留，同名组可替换', () => {
    const existing: TemplateBody = { groups: [{ id: 'main', name: '节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: current.rules, final: { kind: 'group', groupId: 'main' } };
    const text = '- name: 香港节点\n  type: select\n  filter: "(?i)港|HK"\n  hidden: true';
    const result = templateFromYaml(text, existing, ctx);
    expect(result).toMatchObject({ ok: true, value: { groups: [existing.groups[0], { name: '香港节点', filter: '(?i)港|HK' }], final: existing.final, rules: existing.rules } });
    if (!result.ok) throw new Error(result.error);
    expect(templateFromYaml(text, result.value, ctx)).toMatchObject({ ok: true, value: result.value });
    expect(templateFromYaml(text + '\n' + text, result.value, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('重复') });
  });
});
