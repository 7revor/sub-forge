import { chainSources, compileUserRegex, type ChainNodeSet, type ChainRule, type GroupMember, type GroupSpec, type NodeRef, type NodeSetID, type Profile, type ChainTarget, type RuleEntry, type Target } from '@sub-forge/core';
import { exactNodeFilter, NO_NODE_FILTER, nodeSetKey } from './memberModel.ts';

/** 只还原本编辑器生成的精确筛选；历史正则不能被误当成单个节点。 */
export function landingNodeName(landing: ChainRule['landing']): string | undefined {
  if (landing.excludeFilter || !landing.filter?.startsWith('^') || !landing.filter.endsWith('$')) return undefined;
  const name = landing.filter.slice(1, -1).replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
  return name && exactNodeFilter(name) === landing.filter ? name : undefined;
}

/** 还原编辑器勾选生成的 `^a$|^b$`；只要有一段不是精确名称就按历史正则处理。 */
export function landingNodeNames(landing: ChainRule['landing']): string[] | undefined {
  if (landing.excludeFilter || !landing.filter) return undefined;
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < landing.filter.length; i++) {
    const char = landing.filter[i]!;
    if (char === '\\') { current += char + (landing.filter[++i] ?? ''); continue; }
    if (char === '|') { parts.push(current); current = ''; continue; }
    current += char;
  }
  const names = [...parts, current].map(filter => landingNodeName({ nodeSet: landing.nodeSet, filter }));
  return names.every(name => name !== undefined) ? names as string[] : undefined;
}

export function viaConstraintHint(scope: string, match: NodeRef['match']): string {
  if ('exact' in match) return match.exact ? `范围：${scope} · 按名称精确匹配，节点改名后需重新点选` : `范围：${scope} · 尚未选择前置节点`;
  return match.regex ? `范围：${scope} · 沿用已有正则 ${match.regex}，点选节点可替换` : `范围：${scope} · 沿用已有规则：取排在最前的非落地节点，点选节点可替换`;
}

export function landingConstraintHint(scope: string, landing: ChainRule['landing']): string {
  if (landing.filter === NO_NODE_FILTER) return `范围：${scope} · 尚未选择落地节点`;
  if (!landing.filter && !landing.excludeFilter) return `范围：${scope} · 后续新增节点自动纳入，单独配置的节点按其规则`;
  if (landingNodeNames(landing)) return `范围：${scope} · 按名称精确匹配，节点改名后需重新勾选`;
  const rules = [landing.filter && `正则 ${landing.filter}`, landing.excludeFilter && `排除 ${landing.excludeFilter}`].filter(Boolean).join('，');
  return `范围：${scope} · 沿用已有${rules}，点选节点可替换`;
}

const targetUsesKey = (target: ChainTarget, key: string): boolean => target.kind === 'node' && (
  nodeSetKey(target.ref.nodeSet) === key || !!(target.ref.fallback && target.ref.fallback !== 'error' && targetUsesKey(target.ref.fallback, key))
);

/** 同时检查落地、前置与嵌套回退，移出来源后不能留下悬空链引用。 */
export function chainUsesNodeSet(chain: ChainRule, ref: NodeSetID): boolean {
  const key = nodeSetKey(ref);
  return nodeSetKey(chain.landing.nodeSet) === key || targetUsesKey(chain.via, key);
}

export function chainLabel(chain: ChainRule, groupName: (id: string) => string): string {
  const via = chain.via.kind === 'group' ? groupName(chain.via.groupId) : chain.via.kind === 'builtin' ? chain.via.name : 'exact' in chain.via.ref.match ? chain.via.ref.match.exact : '筛选节点';
  return `${via} → ${landingNodeName(chain.landing) ?? (chain.landing.filter || chain.landing.excludeFilter ? '筛选节点' : '全部节点')}`;
}

const chainScopes = (chain: ChainRule): ChainNodeSet[] => {
  const via = (target: ChainTarget): ChainNodeSet[] => target.kind !== 'node' ? [] : [target.ref.nodeSet, ...(target.ref.fallback && target.ref.fallback !== 'error' ? via(target.ref.fallback) : [])];
  return [chain.landing.nodeSet, ...via(chain.via)];
};

function landingIncludes(landing: ChainRule['landing'], name: string): boolean {
  try {
    return (!landing.filter || compileUserRegex(landing.filter).test(name)) && !(landing.excludeFilter && compileUserRegex(landing.excludeFilter).test(name));
  } catch {
    // 历史非法正则无法判断范围：按仍覆盖保留成员，错误由代理链检查展示。
    return true;
  }
}

/** 成员的节点是否走这条代理链；动态的「全部」成员不算填入的具体内容。 */
function chainCoversMember(chain: ChainRule, member: GroupMember, nodeSets: Profile['nodeSets']): boolean {
  if (member.kind !== 'nodeset' && member.kind !== 'node') return false;
  const key = nodeSetKey(member.kind === 'nodeset' ? member.ref : member.ref.nodeSet);
  if (!chainSources(chain.landing.nodeSet, nodeSets).some(source => nodeSetKey(source.ref) === key)) return false;
  return member.kind === 'nodeset' || !('exact' in member.ref.match) || landingIncludes(chain.landing, member.ref.match.exact);
}

/**
 * 单节点成员实际经过的代理链，判定顺序与渲染一致：单节点规则优先，整集规则只作用于其余节点，同类取最后一条。
 * 历史正则成员在编辑时不解析到具体节点：存在单节点规则就无法断言，不显示。
 */
export function chainForNode(chains: ChainRule[], ref: NodeRef, nodeSets: Profile['nodeSets']): ChainRule | undefined {
  const key = nodeSetKey(ref.nodeSet);
  const rules = chains.filter(chain => chainSources(chain.landing.nodeSet, nodeSets).some(source => nodeSetKey(source.ref) === key));
  const partial = rules.filter(chain => chain.landing.filter || chain.landing.excludeFilter);
  const whole = rules.filter(chain => !chain.landing.filter && !chain.landing.excludeFilter).at(-1);
  if (!('exact' in ref.match)) return partial.length ? undefined : whole;
  const name = ref.match.exact;
  return partial.filter(chain => landingIncludes(chain.landing, name)).at(-1) ?? whole;
}

export type ClearedMember = { groupId: string; member: GroupMember };
export type ProfileCascade<T> = { next: T; chains: ChainRule[]; members: ClearedMember[]; rules: number };

/**
 * 节点来源 → 代理链 → 策略组逐级引用：前一级改动后，清除后一级已填入且不再成立的内容。
 * 模板组自身的成员只读，这里只处理订阅可编辑的成员。
 */
export function planProfileChange<T extends Profile>(profile: T, change: { nodeSets?: Profile['nodeSets']; chains?: ChainRule[] }): ProfileCascade<T> {
  const nodeSets = change.nodeSets ?? profile.nodeSets;
  const requested = change.chains ?? profile.chains;
  const removedKeys = profile.nodeSets.map(source => nodeSetKey(source.ref)).filter(key => !nodeSets.some(source => nodeSetKey(source.ref) === key));
  const emptied = (chain: ChainRule) => chainScopes(chain).some(scope => chainSources(scope, profile.nodeSets).length > 0 && !chainSources(scope, nodeSets).length);
  const chains = requested.filter(chain => !emptied(chain));
  const usesRemoved = (target: Target) => removedKeys.some(key => targetUsesKey(target, key));
  // 规则出口的单节点只接受 inline 来源，来源改为引用时一并清除。
  const nowProvider = nodeSets.filter(source => source.output === 'provider' && profile.nodeSets.some(old => nodeSetKey(old.ref) === nodeSetKey(source.ref) && old.output === 'inline')).map(source => nodeSetKey(source.ref));
  const stale = (member: GroupMember) => (member.kind === 'nodeset' ? removedKeys.includes(nodeSetKey(member.ref)) : member.kind === 'node' && usesRemoved(member))
    || (profile.chains.some(chain => chainCoversMember(chain, member, profile.nodeSets)) && !chains.some(chain => chainCoversMember(chain, member, nodeSets)));
  const members: ClearedMember[] = [];
  let rules = 0;
  const cleanMembers = (groupId: string, list: GroupMember[]) => list.filter(member => {
    if (!stale(member)) return true;
    members.push({ groupId, member });
    return false;
  });
  const cleanGroups = (groups: GroupSpec[]) => groups.map(group => ({ ...group, members: cleanMembers(group.id, group.members) }));
  const cleanTarget = (target: Target): Target => {
    if (!usesRemoved(target) && !nowProvider.some(key => targetUsesKey(target, key))) return target;
    rules++;
    return { kind: 'builtin', name: 'REJECT' };
  };
  const cleanRules = (list: RuleEntry[]) => list.map(rule => ({ ...rule, target: cleanTarget(rule.target) }));
  const routing = profile.routing;
  const nextRouting = !routing ? routing : routing.mode === 'independent'
    ? { ...routing, config: { ...routing.config, groups: cleanGroups(routing.config.groups), rules: cleanRules(routing.config.rules), final: cleanTarget(routing.config.final) } }
    : { ...routing,
      groupAdditions: Object.fromEntries(Object.entries(routing.groupAdditions).map(([id, list]) => [id, cleanMembers(id, list)] as const).filter(([, list]) => list.length)),
      ...(routing.extraGroups ? { extraGroups: cleanGroups(routing.extraGroups) } : {}),
      ...(routing.prependRules ? { prependRules: cleanRules(routing.prependRules) } : {}),
      ...(routing.appendRules ? { appendRules: cleanRules(routing.appendRules) } : {}),
    };
  return { next: { ...profile, nodeSets, chains, ...(nextRouting ? { routing: nextRouting } : {}) }, chains: requested.filter(emptied), members, rules };
}

export const hasCascade = (cascade: ProfileCascade<unknown>) => cascade.chains.length > 0 || cascade.members.length > 0 || cascade.rules > 0;

/** 提示正文逐项列出将被清除的内容，取消后草稿不变。 */
export function cascadeDescription(cascade: ProfileCascade<unknown>, lead: string, names: { chain: (chain: ChainRule) => string; member: (item: ClearedMember) => string }): string {
  return [
    lead,
    ...(cascade.chains.length ? ['', `代理链（${cascade.chains.length} 条）`, ...cascade.chains.map(names.chain)] : []),
    ...(cascade.members.length ? ['', `策略组成员（${cascade.members.length} 项）`, ...cascade.members.map(names.member)] : []),
    ...(cascade.rules ? ['', `${cascade.rules} 条规则出口改为 REJECT`] : []),
    '',
    '保存订阅后生效。',
  ].join('\n');
}

export function removeProfileNodeSet<T extends Profile>(profile: T, ref: NodeSetID): ProfileCascade<T> {
  return planProfileChange(profile, { nodeSets: profile.nodeSets.filter(s => nodeSetKey(s.ref) !== nodeSetKey(ref)) });
}
