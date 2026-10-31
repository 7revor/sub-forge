import type { RuleEntry } from '@sub-forge/core';
import type { TemplateBody } from '../../convert/templateYaml.ts';

/** 仅提交匹配内容与选项，保留列表中最新的出口和顺序。 */
export function applyRuleDraft(body: TemplateBody, draft: RuleEntry, adding = false): TemplateBody {
  const previous = body.rules.find(rule => rule.id === draft.id);
  if (!previous && !adding) return body;
  const oldUrl = previous?.matcher.kind === 'ruleset' ? previous.matcher.remote?.url : undefined;
  const newUrl = draft.matcher.kind === 'ruleset' ? draft.matcher.remote?.url : undefined;
  let next = { ...draft, target: previous?.target ?? draft.target };
  if (oldUrl !== newUrl) {
    const { providerName: _providerName, ...rest } = next;
    next = rest;
  }
  const rules = previous ? body.rules.map(rule => rule.id === draft.id ? next : rule) : [...body.rules, next];
  return { ...body, rules, ...(body.ruleProviders && oldUrl && oldUrl !== newUrl ? {
    ruleProviders: body.ruleProviders.filter(provider => provider.url !== oldUrl || rules.some(rule => rule.matcher.kind === 'ruleset' && rule.matcher.remote?.url === oldUrl)),
  } : {}) };
}

/** 绑定模板时新增自定义规则，可插入模板块之前；不改动模板块内顺序。 */
export function applyRuleDialogResult(body: TemplateBody, draft: RuleEntry, adding: boolean, position: 'before' | 'after', templateIds?: string[], templateStart = 0) {
  const next = applyRuleDraft(body, draft, adding);
  if (!adding || !templateIds || position === 'after') return { body: next, templateStart: undefined };
  const first = next.rules.findIndex(rule => templateIds.includes(rule.id));
  const rules = next.rules.filter(rule => rule.id !== draft.id);
  const at = first < 0 ? templateStart : first;
  rules.splice(at, 0, draft);
  return { body: { ...next, rules }, templateStart: at + 1 };
}
