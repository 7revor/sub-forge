import { remoteRuleMatcher, type RuleEntry } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import type { TemplateBody } from '../../convert/templateYaml.ts';
import { applyRuleDraft, applyRuleDialogResult } from './ruleDraft.ts';

const url = 'https://example.test/rules.list';
const direct = { kind: 'builtin', name: 'DIRECT' } as const;
const rule: RuleEntry = { id: 'r', matcher: remoteRuleMatcher(url), target: direct, providerName: '原始来源', options: { src: true } };
const body: TemplateBody = { groups: [], rules: [rule], final: direct, ruleProviders: [{ name: '原始来源', url }] };

describe('规则弹窗草稿提交', () => {
  it('保存匹配内容时保留最新出口、规则标识和排序，并清理失去引用的远程来源', () => {
    const latest = { ...body, rules: [{ ...rule, target: { kind: 'builtin', name: 'REJECT' } as const }] };
    const draft: RuleEntry = { ...structuredClone(rule), matcher: { kind: 'rule', rule: { type: 'RAW', text: 'DOMAIN,example.test' } } };
    const result = applyRuleDraft(latest, draft);
    expect(result.rules[0]).toEqual({ id: 'r', matcher: draft.matcher, target: { kind: 'builtin', name: 'REJECT' }, options: { src: true } });
    expect(result.ruleProviders).toEqual([]);
    expect(body.rules[0]).toEqual(rule);
  });
  it('仍有其他规则引用同一地址时保留远程来源定义', () => {
    const shared = { ...body, rules: [rule, { ...rule, id: 'other' }] };
    const changed = { ...rule, matcher: remoteRuleMatcher('https://example.test/new.list') };
    expect(applyRuleDraft(shared, changed).ruleProviders).toEqual(body.ruleProviders);
  });
  it('仅修改规则选项时保留原始远程来源名称', () => {
    const result = applyRuleDraft(body, { ...rule, options: { src: false } });
    expect(result.rules[0]?.providerName).toBe('原始来源');
    expect(result.rules[0]?.options?.src).toBe(false);
  });
  it('已删除的规则不会被迟到的保存重新创建', () => {
    const removed = { ...body, rules: [] };
    expect(applyRuleDraft(removed, rule)).toBe(removed);
  });
  it('新增草稿仅在明确保存时追加到末尾', () => {
    const draft = { ...rule, id: 'new' };
    expect(applyRuleDraft(body, draft)).toBe(body);
    expect(applyRuleDraft(body, draft, true).rules.map(rule => rule.id)).toEqual(['r', 'new']);
    expect(body.rules).toHaveLength(1);
  });
  it('模板前插入保留前置规则和整个模板块，回传正确边界', () => {
    const current = { ...body, rules: ['pre', 'tpl-a', 'tpl-b', 'post'].map(id => ({ ...rule, id })) };
    const result = applyRuleDialogResult(current, { ...rule, id: 'new' }, true, 'before', ['tpl-a', 'tpl-b'], 1);
    expect(result.body.rules.map(r => r.id)).toEqual(['pre', 'new', 'tpl-a', 'tpl-b', 'post']);
    expect(result.templateStart).toBe(2);
    expect(current.rules.map(r => r.id)).toEqual(['pre', 'tpl-a', 'tpl-b', 'post']);
  });
  it('模板后添加与空模板的前置边界相互独立', () => {
    const draft = { ...rule, id: 'new' };
    expect(applyRuleDialogResult(body, draft, true, 'after', ['r'], 0).body.rules.map(r => r.id)).toEqual(['r', 'new']);
    const emptyTemplate = applyRuleDialogResult(body, draft, true, 'before', [], 0);
    expect(emptyTemplate.body.rules.map(r => r.id)).toEqual(['new', 'r']);
    expect(emptyTemplate.templateStart).toBe(1);
  });
});
