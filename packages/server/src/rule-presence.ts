// 规则以存在与否决定生效。旧 enabled:false 条目删除，其余条目清除遗留标记。
// 只处理规则与规则来源，处理链和仓库自己的启停机制保持原语义。
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const active = (items: unknown, normalize: (item: Record<string, unknown>) => Record<string, unknown> = item => item): unknown => {
  if (!Array.isArray(items)) return items;
  return items.filter(item => !obj(item) || item.enabled !== false).map(item => {
    if (!obj(item)) return item;
    const { enabled: _, ...rest } = item;
    return normalize(rest);
  });
};
const matcher = (value: unknown): unknown => obj(value) && value.kind === 'ruleset' && obj(value.repository)
  ? { ...value, repository: { ...value.repository, sources: active(value.repository.sources) } } : value;
const ruleOptions = (value: unknown): unknown => {
  if (!obj(value)) return value;
  const { noResolve: _, ...options } = value;
  return options;
};
const normalizeRule = (rule: Record<string, unknown>) => ({ ...rule, matcher: matcher(rule.matcher),
  ...(rule.options !== undefined ? { options: ruleOptions(rule.options) } : {}) });
const rules = (value: unknown): unknown => active(value, normalizeRule);

export function normalizeRulePresence<T>(kind: string, value: T): T {
  if (!obj(value)) return value;
  let next: Record<string, unknown> = value;
  if (kind === 'ruleset') {
    const { noResolve: _, ...ruleset } = value;
    next = { ...ruleset, sources: active(value.sources) };
  }
  if (kind === 'template') next = { ...value, rules: rules(value.rules) };
  if (kind === 'profile' && obj(value.routing)) {
    const routing = value.routing;
    if (routing.mode === 'bound' && routing.prependRules !== undefined) next = { ...value, routing: { ...routing, prependRules: rules(routing.prependRules) } };
    if (routing.mode === 'independent' && obj(routing.config)) next = { ...value, routing: { ...routing, config: normalizeRulePresence('template', routing.config) } };
  }
  // 旧订阅先清除额外选项，再进行分流模式迁移；原文和结构化规则中的标记保留。
  if (kind === 'profile' && obj(next.overlay) && Array.isArray(next.overlay.extraRules)) next = { ...next, overlay: { ...next.overlay,
    extraRules: next.overlay.extraRules.map(extra => obj(extra) && obj(extra.rule) ? { ...extra, rule: normalizeRule(extra.rule) } : extra) } };
  return next as T;
}
