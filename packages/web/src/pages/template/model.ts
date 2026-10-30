import { localRulesError, rawRuleError, type ReportItem, type RuleIR } from '@sub-forge/core';
import type { TemplateBody } from '../../convert/templateYaml.ts';

export function incompleteRule(rule: RuleIR): boolean {
  if ('value' in rule) return !rule.value.trim();
  if (rule.type === 'RAW') return !!rawRuleError(rule.text);
  return !rule.children.length || rule.children.some(incompleteRule);
}

/** 服务端模板校验不检查单条规则的空值，草稿在此补齐检查。 */
export function draftIssues(body: TemplateBody): ReportItem[] {
  return [
    ...body.groups.filter((g) => !g.name.trim()).map((g): ReportItem => ({
      level: 'error', code: 'template.empty-name', message: '请填写策略组名称', where: `group:${g.id}`,
    })),
    ...body.rules.filter((r) => r.matcher.kind === 'local' ? !!localRulesError(r.matcher) : r.matcher.kind === 'rule' ? incompleteRule(r.matcher.rule) : !r.matcher.id).map((r): ReportItem => ({
      level: 'error', code: 'template.empty-matcher', message: '请补全规则匹配项后再保存', where: `rule:${r.id}`,
    })),
  ];
}

export function removeGroup(body: TemplateBody, id: string): TemplateBody {
  const target = (value: TemplateBody['final']): TemplateBody['final'] => value.kind === 'group' && value.groupId === id ? { kind: 'builtin', name: 'REJECT' } : value;
  return {
    ...body,
    groups: body.groups.filter((g) => g.id !== id).map((g) => ({ ...g, members: g.members.filter((m) => m.kind !== 'group' || m.groupId !== id) })),
    rules: body.rules.map((r) => ({ ...r, target: target(r.target) })),
    final: target(body.final),
  };
}
