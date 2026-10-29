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
const rules = (value: unknown): unknown => active(value, rule => ({ ...rule, matcher: matcher(rule.matcher) }));

export function normalizeRulePresence<T>(kind: string, value: T): T {
  if (!obj(value)) return value;
  let next: Record<string, unknown> = value;
  if (kind === 'ruleset') next = { ...value, sources: active(value.sources) };
  if (kind === 'template') next = { ...value, rules: rules(value.rules) };
  if (kind === 'profile' && obj(value.routing)) {
    const routing = value.routing;
    if (routing.mode === 'bound' && routing.prependRules !== undefined) next = { ...value, routing: { ...routing, prependRules: rules(routing.prependRules) } };
    if (routing.mode === 'independent' && obj(routing.config)) next = { ...value, routing: { ...routing, config: normalizeRulePresence('template', routing.config) } };
  }
  return next as T;
}
