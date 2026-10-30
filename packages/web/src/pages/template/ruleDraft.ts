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
