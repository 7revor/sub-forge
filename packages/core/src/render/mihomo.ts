// mihomo 渲染（docs/03 §3 ②–⑥、§4）：模板合并 → 节点集 → 依赖解析 → 规则展开 → 引用校验 → YAML。
// 纯函数：所有外部数据（快照、模板、规则集）由调用方传入。

import { stringify } from 'yaml';
import { NodeSetResolver, nodeSetKey, type NodeSetInputs } from '../nodeset/resolve.ts';
import { Report } from '../report.ts';
import { applyOverrides, composeRule, lowerRule, withIpOptions, type ClientCtx } from '../rules/client.ts';
import { expandBundle, type RuleSetInputs } from '../rules/expand.ts';
import type { Behavior } from '../rules/parse.ts';
import { mergeTemplate, type EffectiveGroup } from '../template/merge.ts';
import type { GroupMember, NodeRef, NodeSetID, Platform, Profile, ProxyIR, RefStrategy, RuleIR, Target, Template } from '../types.ts';
import { shortHash } from '../util/hash.ts';
import { compileUserRegex, exactNameRegex } from '../util/regex.ts';

export type UrlBuilder = {
  /** Profile 专属 provider 地址（/p/:token/:key?v=） */
  provider(nodeSetKey: string, version: string): string;
  /** 转换后的规则集地址（/r/:token/:key） */
  ruleset(key: string): string;
};

export type RenderInput = {
  profile: Profile;
  template?: Template;
  nodeSets: NodeSetInputs;
  rules: RuleSetInputs;
  platform?: Platform;
  urls: UrlBuilder;
  /** 已合并好的 mihomo 基础设置（预设 ⊕ Profile 覆盖），原样放在配置顶部 */
  base?: Record<string, unknown>;
};

/** 依赖节点面板的一行（REF-07） */
export type DependencyEntry = {
  refKey: string;
  nodeSet: string;
  node: string;
  strategy: RefStrategy;
  /** 引用方实际写入的名称：包装组名或本地副本名 */
  output: string;
  usedBy: string[];
};

export type ProviderOutput = { name: string; version: string; yaml: string };
export type RulesetOutput = { behavior: Behavior; text: string };

export type MihomoRenderResult = {
  config: Record<string, unknown>;
  yaml: string;
  providers: Record<string, ProviderOutput>;
  rulesets: Record<string, RulesetOutput>;
  dependencies: DependencyEntry[];
  report: Report;
};

const BUILTINS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const PROVIDER_INTERVAL = 3600;
const RULESET_INTERVAL = 86400;
/**
 * 从本服务下载 provider / 规则集时走直连。mihomo 默认让这类下载也经过分流规则：
 * 若 MATCH 指向的组依赖代理链，而链的前置又在待下载的 provider 里，就会互相等待、永远加载不上
 * （Docker 集成测试"落地内联"用例复现）。
 */
const FETCH_VIA = 'DIRECT';

const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');

/** 某个节点集需要整体改为内联输出（refPolicy = inline），从头重新渲染 */
class InlineRestart extends Error {
  constructor(readonly nodeSetKey: string) { super(`inline ${nodeSetKey}`); }
}

type NS = {
  key: string;
  ref: NodeSetID;
  output: 'provider' | 'inline';
  providerName: string;
  /** 本次渲染的节点副本，可以写入 dialer-proxy */
  nodes: ProxyIR[];
};

type MihomoGroup = Record<string, unknown> & { name: string; proxies?: string[]; use?: string[] };

export function renderMihomo(input: RenderInput): MihomoRenderResult {
  const forced = new Set<string>();
  for (;;) {
    try {
      return renderOnce(input, forced);
    } catch (e) {
      if (!(e instanceof InlineRestart)) throw e;
      if (forced.has(e.nodeSetKey)) throw new Error(`依赖解析未收敛：${e.nodeSetKey}`);
      forced.add(e.nodeSetKey);
    }
  }
}

function displayName(ref: NodeSetID, inputs: NodeSetInputs): string {
  const src = ref.type === 'source' ? inputs.sources[ref.id] : ref.type === 'collection' ? inputs.collections[ref.id] : inputs.locals[ref.id];
  return src?.name ?? ref.id;
}

function filterNodes(nodes: ProxyIR[], f: { filter?: string; excludeFilter?: string; excludeType?: string }): ProxyIR[] {
  const inc = f.filter ? compileUserRegex(f.filter) : undefined;
  const exc = f.excludeFilter ? compileUserRegex(f.excludeFilter) : undefined;
  const types = f.excludeType ? new Set(f.excludeType.split('|').map((t) => t.trim().toLowerCase())) : undefined;
  return nodes.filter((n) => (!inc || inc.test(n.name)) && (!exc || !exc.test(n.name)) && (!types || !types.has(n.type.toLowerCase())));
}

function stripNode(n: ProxyIR): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_') || k === 'dialer' || k === 'upstreamDialer') continue;
    out[k] = v;
  }
  return out;
}

function renderOnce(input: RenderInput, forcedInline: Set<string>): MihomoRenderResult {
  const { profile } = input;
  const report = new Report();
  const ctx: ClientCtx = input.platform ? { client: 'mihomo', platform: input.platform } : { client: 'mihomo' };
  const eff = mergeTemplate(input.template, profile.overlay, report);
  const resolver = new NodeSetResolver(input.nodeSets, report);

  // ---------- 节点集 ----------
  const sets = new Map<string, NS>();
  const providerNames = new Set<string>();
  for (const ps of profile.nodeSets) {
    const key = nodeSetKey(ps.ref);
    if (sets.has(key)) { report.warn('nodeset.duplicate', '节点集重复加入，已忽略', key); continue; }
    let providerName = ps.providerName ?? displayName(ps.ref, input.nodeSets);
    for (let i = 2; providerNames.has(providerName); i++) providerName = `${ps.providerName ?? displayName(ps.ref, input.nodeSets)} (${i})`;
    providerNames.add(providerName);
    sets.set(key, {
      key, ref: ps.ref, providerName,
      output: forcedInline.has(key) ? 'inline' : ps.output,
      nodes: resolver.resolve(ps.ref).map((n) => ({ ...n })),
    });
  }

  // ---------- 顶层名称表 ----------
  const topNames = new Set<string>();
  for (const s of sets.values()) {
    if (s.output !== 'inline') continue;
    for (const n of s.nodes) {
      if (topNames.has(n.name)) {
        const orig = n.name;
        let i = 2;
        while (topNames.has(`${orig} ${i}`)) i++;
        n.name = `${orig} ${i}`;
        report.warn('inline.name-conflict', `内联节点「${orig}」与其他节点集重名，已改为「${n.name}」`, s.key);
      }
      topNames.add(n.name);
    }
  }
  const groupName = new Map(eff.groups.map((g) => [g.id, g.name]));
  const groupNames = new Set(groupName.values());
  for (const g of eff.groups) {
    if (topNames.has(g.name) || BUILTINS.has(g.name)) report.error('name.conflict', `组名「${g.name}」与节点或内置策略重名`, `group:${g.id}`);
  }

  // ---------- 引用解析 ----------
  const wrappers: MihomoGroup[] = [];
  // 副本在输出时才生成，这样能带上之后注入的 dialer-proxy
  const copies: { node: ProxyIR; name: string }[] = [];
  const deps = new Map<string, DependencyEntry>();
  const wrapperNode = new Map<string, { set: NS; node: ProxyIR }>();

  const findNode = (ref: NodeRef, where: string): { set: NS; node: ProxyIR } | undefined => {
    const set = sets.get(nodeSetKey(ref.nodeSet));
    if (!set) { report.error('ref.nodeset-not-in-profile', `引用的节点集 ${nodeSetKey(ref.nodeSet)} 未加入本 Profile`, where); return undefined; }
    const node = 'exact' in ref.match
      ? set.nodes.find((n) => n.name === (ref.match as { exact: string }).exact)
      : (() => { const re = compileUserRegex((ref.match as { regex: string }).regex); return set.nodes.find((n) => re.test(n.name)); })();
    return node ? { set, node } : undefined;
  };

  const nameForNode = (set: NS, node: ProxyIR, where: string): string => {
    if (set.output === 'inline') return node.name;
    const refKey = `${set.key}|${node._key}`;
    const hit = deps.get(refKey);
    if (hit) { if (!hit.usedBy.includes(where)) hit.usedBy.push(where); return hit.output; }
    const strategy = profile.refPolicy.perRef?.[refKey] ?? profile.refPolicy.default;
    let output: string;
    if (strategy === 'inline') throw new InlineRestart(set.key);
    if (strategy === 'wrap') {
      // 名称只依赖节点身份，不随显示名变化（REF-11）
      output = `__ref_${safeId(set.ref.id)}_${shortHash(refKey, 8)}`;
      wrappers.push({ name: output, type: 'select', use: [set.providerName], filter: exactNameRegex(node.name), hidden: true, 'empty-fallback': 'REJECT' });
      wrapperNode.set(output, { set, node });
    } else {
      // 复制到本地：provider 中保留原节点，副本名冲突时加后缀
      output = node.name;
      for (let i = 1; topNames.has(output) || groupNames.has(output); i++) output = i === 1 ? `${node.name} ·local` : `${node.name} ·local ${i}`;
      copies.push({ node, name: output });
      topNames.add(output);
    }
    deps.set(refKey, { refKey, nodeSet: set.key, node: node.name, strategy, output, usedBy: [where] });
    return output;
  };

  const resolveTarget = (t: Target, where: string): string | undefined => {
    if (t.kind === 'builtin') return t.name;
    if (t.kind === 'group') {
      const n = groupName.get(t.groupId);
      if (n === undefined) report.error('ref.dangling-group', `引用的组 ${t.groupId} 不存在`, where);
      return n;
    }
    const found = findNode(t.ref, where);
    if (found) return nameForNode(found.set, found.node, where);
    const desc = 'exact' in t.ref.match ? t.ref.match.exact : `/${t.ref.match.regex}/`;
    const fb = t.ref.fallback;
    if (fb && fb !== 'error') {
      const name = resolveTarget(fb, where);
      report.warn('ref.fallback', `节点 ${desc} 在 ${nodeSetKey(t.ref.nodeSet)} 中已不存在，回退到 ${name}`, where);
      return name;
    }
    report.error('ref.unresolved', `节点 ${desc} 在 ${nodeSetKey(t.ref.nodeSet)} 中已不存在`, where);
    return undefined;
  };

  // ---------- 策略组 ----------
  const lowerGroup = (g: EffectiveGroup): MihomoGroup => {
    const where = `group:${g.id}`;
    const out: MihomoGroup = { name: g.name, type: g.type };
    const proxies: string[] = [];
    const use: string[] = [];
    const filterSpec = { filter: g.filter, excludeFilter: g.excludeFilter, excludeType: g.excludeType };
    for (const m of g.members as GroupMember[]) {
      if (m.kind === 'builtin') proxies.push(m.name);
      else if (m.kind === 'group') { const n = resolveTarget({ kind: 'group', groupId: m.groupId }, where); if (n) proxies.push(n); }
      else if (m.kind === 'node') { const n = resolveTarget({ kind: 'node', ref: m.ref }, where); if (n) proxies.push(n); }
      else if (m.kind === 'nodeset') {
        const s = sets.get(nodeSetKey(m.ref));
        if (!s) { report.error('ref.nodeset-not-in-profile', `组成员节点集 ${nodeSetKey(m.ref)} 未加入本 Profile`, where); continue; }
        if (s.output === 'provider') use.push(s.providerName);
        else proxies.push(...filterNodes(s.nodes, filterSpec).map((n) => n.name)); // 内联节点不受 filter 约束，服务端预过滤
      } else {
        out[m.scope === 'all' ? 'include-all' : m.scope === 'proxies' ? 'include-all-proxies' : 'include-all-providers'] = true;
      }
    }
    const hasInclude = ['include-all', 'include-all-proxies', 'include-all-providers'].some((k) => out[k]);
    if (!proxies.length && !use.length && !hasInclude) {
      // 空组（TPL-10）：两个客户端都不接受无成员的组
      const direct = g.whenEmpty === 'direct';
      proxies.push(direct ? 'COMPATIBLE' : 'REJECT');
      report.warn('group.empty', `组「${g.name}」没有成员，按${direct ? '直连' : '拒绝'}输出`, where);
    }
    if (proxies.length) out.proxies = proxies;
    if (use.length) out.use = use;
    if (use.length || hasInclude) {
      // 动态成员在客户端刷新后也可能筛空，不能只保护渲染时的静态空组。
      out['empty-fallback'] = g.whenEmpty === 'direct' ? 'COMPATIBLE' : 'REJECT';
      if (g.filter) out.filter = g.filter;
      if (g.excludeFilter) out['exclude-filter'] = g.excludeFilter;
      if (g.excludeType) out['exclude-type'] = g.excludeType;
    }
    const t = g.test ?? {};
    if (g.type !== 'select') {
      if (t.url) out.url = t.url;
      if (t.interval !== undefined) out.interval = t.interval;
      if (t.timeout !== undefined) out.timeout = t.timeout;
      if (t.tolerance !== undefined && g.type === 'url-test') out.tolerance = t.tolerance;
      if (t.lazy !== undefined) out.lazy = t.lazy;
      if (t.maxFailedTimes !== undefined) out['max-failed-times'] = t.maxFailedTimes;
      if (t.expectedStatus !== undefined) out['expected-status'] = t.expectedStatus;
    }
    if (g.type === 'load-balance' && g.strategy) out.strategy = g.strategy;
    if (g.display?.hidden) out.hidden = true;
    if (g.display?.icon) out.icon = g.display.icon;
    return { ...out, ...(g.extra ?? {}) } as MihomoGroup;
  };
  const groups = eff.groups.map(lowerGroup);

  // ---------- 代理链（REF-03 / REF-04 / REF-06）----------
  const providerOverride = new Map<string, string>();
  const setDialer = (set: NS, node: ProxyIR, via: string) => { node['dialer-proxy'] = via; };

  for (const set of sets.values()) {
    for (const n of set.nodes) {
      if (n.upstreamDialer) {
        const where = `node:${set.key}:${n.name}`;
        const target = set.nodes.find((x) => x !== n && (x._origName === n.upstreamDialer || x.name === n.upstreamDialer));
        const via = target ? nameForNode(set, target, where) : topNames.has(n.upstreamDialer) || groups.some((g) => g.name === n.upstreamDialer) ? n.upstreamDialer : undefined;
        if (via) setDialer(set, n, via);
        else report.error('ref.upstream-dialer-missing', `节点「${n.name}」自带的前置「${n.upstreamDialer}」找不到，拒绝发布缺少前置的配置`, where);
      }
      if (n.dialer) {
        const via = resolveTarget(n.dialer, `node:${set.key}:${n.name}`);
        if (via) setDialer(set, n, via);
      }
    }
  }
  for (const chain of profile.chains) {
    const where = `chain:${chain.id}`;
    const set = sets.get(nodeSetKey(chain.landing.nodeSet));
    if (!set) { report.error('ref.nodeset-not-in-profile', `链规则的落地节点集 ${nodeSetKey(chain.landing.nodeSet)} 未加入本 Profile`, where); continue; }
    const via = resolveTarget(chain.via, where);
    if (!via) continue;
    const whole = !chain.landing.filter && !chain.landing.excludeFilter;
    if (set.output === 'provider' && whole) { providerOverride.set(set.key, via); continue; }
    const matched = filterNodes(set.nodes, chain.landing);
    if (!matched.length) report.warn('chain.no-landing', '链规则没有命中任何落地节点', where);
    for (const n of matched) setDialer(set, n, via);
  }

  // ---------- 链环与跳数（REF-09）----------
  checkChains(sets, groups, wrappers, wrapperNode, copies, providerOverride, report);

  // ---------- 规则 ----------
  const ruleLines: string[] = [];
  const ruleProviders: Record<string, Record<string, unknown>> = {};
  const rulesets: Record<string, RulesetOutput> = {};
  const lowerInline = (rule: RuleIR, where: string): string | undefined => {
    const l = lowerRule(rule, ctx);
    if (l.kind === 'drop') { report.info('rule.dropped', l.reason, where); return undefined; }
    if (l.note) report.info('rule.degraded', l.note, where);
    return composeRule(l);
  };

  for (const r of eff.rules) {
    if (r.enabled === false) continue;
    const where = `rule:${r.id}`;
    const target = resolveTarget(r.target, where);
    if (target === undefined) continue;
    const m = r.matcher;
    if (m.kind === 'rule') {
      for (const rule of applyOverrides(m.rule, m.overrides, ctx)) {
        const l = lowerRule(withIpOptions(rule, r.options ?? {}), ctx);
        if (l.kind === 'drop') { report.info('rule.dropped', l.reason, where); continue; }
        if (l.note) report.info('rule.degraded', l.note, where);
        ruleLines.push(composeRule(l, target));
      }
      continue;
    }
    // 不同规则级选项可能改变 classical 正文或 CIDR 分段，不能共用同名 provider。
    const base = `${m.kind === 'bundle' ? 'b' : 'rs'}_${safeId(m.id)}${r.options?.noResolve ? '_nr' : ''}${r.options?.src ? '_src' : ''}`;
    const bundleInputs = m.kind === 'bundle' ? input.rules : { ...input.rules, bundles: { ...input.rules.bundles, [base]: { id: base, name: m.id, items: [{ kind: 'ruleset' as const, id: m.id }] } } };
    const buckets = expandBundle(m.kind === 'bundle' ? m.id : base, bundleInputs, ctx, report);
    const noResolve = (m.kind === 'bundle' && input.rules.bundles[m.id]?.noResolve) || r.options?.noResolve;
    // domain → classical → ipcidr：IP 类放最后，避免过早触发 DNS 解析（RB-03）
    for (const behavior of ['domain', 'classical', 'ipcidr'] as const) {
      const list = buckets[behavior].map(rule => withIpOptions(rule, r.options ?? {}));
      if (!list.length) continue;
      // CIDR 文本无法承载行级选项。按连续的选项组合拆段，保留原顺序及解析行为。
      const segments: { rules: RuleIR[]; noResolve: boolean; src: boolean }[] = [];
      for (const rule of list) {
        const flags = { noResolve: behavior === 'ipcidr' && 'noResolve' in rule && !!rule.noResolve, src: behavior === 'ipcidr' && 'src' in rule && !!rule.src };
        const last = segments.at(-1);
        if (last && last.noResolve === flags.noResolve && last.src === flags.src) last.rules.push(rule);
        else segments.push({ rules: [rule], ...flags });
      }
      for (const [index, segment] of segments.entries()) {
        const key = `${base}_${behavior}${segments.length > 1 ? `_part${index + 1}` : ''}`;
        if (!rulesets[key]) {
          const list = segment.rules;
          const lines = behavior === 'domain'
            ? list.map((x) => (x.type === 'DOMAIN-SUFFIX' ? `+.${(x as { value: string }).value}` : (x as { value: string }).value))
            : behavior === 'ipcidr'
              ? list.map((x) => (x as { value: string }).value)
              : list.map((x) => lowerInline(x, where)).filter((x): x is string => x !== undefined);
          if (!lines.length) continue;
          rulesets[key] = { behavior, text: lines.join('\n') + '\n' };
          ruleProviders[key] = { type: 'http', behavior, format: 'text', url: input.urls.ruleset(key), interval: RULESET_INTERVAL, proxy: FETCH_VIA };
        }
        ruleLines.push(composeRule({ text: `RULE-SET,${key}`, noResolve: segment.noResolve, src: segment.src }, target));
      }
    }
    for (const p of buckets.passthrough) {
      const rs = input.rules.rulesets[p.id];
      const key = `${base}_${safeId(p.id)}_${p.format}`;
      if (p.format !== 'mrs' || !p.url || !rs?.behavior || rs.behavior === 'classical') {
        report.warn('ruleset.passthrough-unusable', `规则集「${rs?.name ?? p.id}」（${p.format}）无法用于 mihomo：需要 mrs 格式、URL 与 domain/ipcidr behavior`, where);
        continue;
      }
      ruleProviders[key] ??= { type: 'http', behavior: rs.behavior, format: 'mrs', url: p.url, interval: RULESET_INTERVAL };
      ruleLines.push(composeRule({ text: `RULE-SET,${key}`, noResolve: rs.behavior === 'ipcidr' && !!noResolve, src: rs.behavior === 'ipcidr' && !!r.options?.src }, target));
    }
  }
  const finalName = resolveTarget(eff.final, 'final') ?? 'DIRECT';
  ruleLines.push(`MATCH,${finalName}`);

  // ---------- 输出 ----------
  const inlineProxies = [...[...sets.values()].filter((s) => s.output === 'inline').flatMap((s) => s.nodes), ...copies.map((c) => ({ ...c.node, name: c.name }))].map(stripNode);
  const providers: Record<string, ProviderOutput> = {};
  const proxyProviders: Record<string, Record<string, unknown>> = {};
  for (const s of sets.values()) {
    if (s.output !== 'provider') continue;
    const yaml = stringify({ proxies: s.nodes.map(stripNode) }, { lineWidth: 0 });
    // 版本号随内容（含注入的前置）变化，客户端重载主配置即重新下载；不输出 path（REF-11）
    const version = shortHash(`${yaml}|${providerOverride.get(s.key) ?? ''}`, 8);
    providers[s.key] = { name: s.providerName, version, yaml };
    const entry: Record<string, unknown> = { type: 'http', url: input.urls.provider(s.key, version), interval: PROVIDER_INTERVAL, proxy: FETCH_VIA };
    const ov = providerOverride.get(s.key);
    if (ov) entry.override = { 'dialer-proxy': ov };
    proxyProviders[s.providerName] = entry;
  }

  const allGroups = [...groups, ...wrappers];
  validateReferences(allGroups, inlineProxies, providers, providerOverride, proxyProviders, report);

  const config: Record<string, unknown> = { ...(input.base ?? {}), proxies: inlineProxies };
  if (Object.keys(proxyProviders).length) config['proxy-providers'] = proxyProviders;
  config['proxy-groups'] = allGroups;
  if (Object.keys(ruleProviders).length) config['rule-providers'] = ruleProviders;
  config.rules = ruleLines;

  return {
    config,
    yaml: stringify(config, { lineWidth: 0 }),
    providers,
    rulesets,
    dependencies: [...deps.values()],
    report,
  };
}

/**
 * 引用校验（REF-08）：dialer-proxy、组成员、use 都必须能在顶层表中找到。
 * provider 内节点的 dialer-proxy 写错时 mihomo 加载不报错，只在运行时失败，必须在这里兜住。
 */
function validateReferences(
  groups: MihomoGroup[],
  inlineProxies: Record<string, unknown>[],
  providers: Record<string, ProviderOutput>,
  providerOverride: Map<string, string>,
  proxyProviders: Record<string, unknown>,
  report: Report,
): void {
  const names = new Set<string>([...BUILTINS, ...inlineProxies.map((p) => String(p.name)), ...groups.map((g) => g.name)]);
  for (const g of groups) {
    for (const p of g.proxies ?? []) if (!names.has(p)) report.error('verify.dangling', `组「${g.name}」的成员「${p}」不存在`, `group:${g.name}`);
    for (const u of g.use ?? []) if (!(u in proxyProviders)) report.error('verify.dangling', `组「${g.name}」引用的 provider「${u}」不存在`, `group:${g.name}`);
  }
  const checkDialer = (d: unknown, where: string) => {
    if (typeof d === 'string' && !names.has(d)) report.error('verify.dangling', `dialer-proxy「${d}」不在顶层表中`, where);
  };
  for (const p of inlineProxies) checkDialer(p['dialer-proxy'], `proxy:${String(p.name)}`);
  for (const [key, prov] of Object.entries(providers)) {
    for (const line of prov.yaml.split('\n')) {
      const m = /^\s+dialer-proxy: (.+)$/.exec(line);
      if (m) checkDialer(m[1]!.replace(/^["']|["']$/g, ''), `provider:${key}`);
    }
  }
  for (const [key, via] of providerOverride) checkDialer(via, `provider:${key}`);
}

/**
 * 前置链环检测与跳数提示（REF-09）。mihomo 只检测本地节点的环，跨 provider 的环由这里兜住。
 * 图的节点是具体代理节点；边是"节点 → 其前置可能落到的节点"（经组展开）。
 */
function checkChains(
  sets: Map<string, NS>,
  groups: MihomoGroup[],
  wrappers: MihomoGroup[],
  wrapperNode: Map<string, { set: NS; node: ProxyIR }>,
  copies: { node: ProxyIR; name: string }[],
  providerOverride: Map<string, string>,
  report: Report,
): void {
  const id = (s: NS, n: ProxyIR) => `${s.key}|${n._key}|${n.name}`;
  const byName = new Map<string, string[]>();
  const nodeById = new Map<string, { set: NS; node: ProxyIR }>();
  const providerNodes = new Map<string, string[]>();
  for (const s of sets.values()) {
    const ids: string[] = [];
    for (const n of s.nodes) {
      const nid = id(s, n);
      nodeById.set(nid, { set: s, node: n });
      ids.push(nid);
      if (s.output === 'inline') byName.set(n.name, [nid]);
    }
    if (s.output === 'provider') providerNodes.set(s.providerName, ids);
  }
  for (const c of copies) {
    const entry = [...nodeById].find(([, value]) => value.node === c.node);
    if (entry) byName.set(c.name, [entry[0]]);
  }
  const groupByName = new Map([...groups, ...wrappers].map((g) => [g.name, g]));

  const expand = (name: string, seen = new Set<string>()): string[] => {
    const w = wrapperNode.get(name);
    if (w) return [id(w.set, w.node)];
    const direct = byName.get(name);
    if (direct) return direct;
    const g = groupByName.get(name);
    if (!g || seen.has(name)) return [];
    const next = new Set([...seen, name]);
    const filter = {
      ...(typeof g.filter === 'string' ? { filter: g.filter } : {}),
      ...(typeof g['exclude-filter'] === 'string' ? { excludeFilter: g['exclude-filter'] } : {}),
      ...(typeof g['exclude-type'] === 'string' ? { excludeType: g['exclude-type'] } : {}),
    };
    const dynamic: { nid: string; node: ProxyIR }[] = [];
    const providers = g['include-all'] || g['include-all-providers'] ? [...providerNodes.keys()] : g.use ?? [];
    for (const u of providers) for (const nid of providerNodes.get(u) ?? []) dynamic.push({ nid, node: nodeById.get(nid)!.node });
    if (g['include-all'] || g['include-all-proxies']) {
      for (const [proxyName, ids] of byName) for (const nid of ids) dynamic.push({ nid, node: { ...nodeById.get(nid)!.node, name: proxyName } });
    }
    // 显式 proxies 不受动态 filter 约束；use/include-all 按客户端相同的筛选条件展开。
    return [...new Set([
      ...(g.proxies ?? []).flatMap((p) => expand(p, next)),
      ...dynamic.filter(({ node }) => filterNodes([node], filter).length > 0).map(({ nid }) => nid),
    ])];
  };
  const dialerOf = (nid: string): string | undefined => {
    const { set, node } = nodeById.get(nid)!;
    return providerOverride.get(set.key) ?? (node['dialer-proxy'] as string | undefined);
  };

  const depth = new Map<string, number>();
  const onStack = new Set<string>();
  const reported = new Set<string>();
  const visit = (nid: string, path: string[]): number => {
    const memo = depth.get(nid);
    if (memo !== undefined) return memo;
    if (onStack.has(nid)) {
      const cyc = [...path.slice(path.indexOf(nid)), nid].map((x) => nodeById.get(x)!.node.name);
      const k = [...cyc].sort().join('|');
      if (!reported.has(k)) { reported.add(k); report.error('chain.cycle', `前置链成环：${cyc.join(' → ')}`); }
      return 0;
    }
    const d = dialerOf(nid);
    if (!d) { depth.set(nid, 0); return 0; }
    onStack.add(nid);
    let max = 0;
    for (const next of expand(d)) max = Math.max(max, 1 + visit(next, [...path, nid]));
    onStack.delete(nid);
    depth.set(nid, max);
    return max;
  };
  for (const nid of nodeById.keys()) {
    const hops = visit(nid, []);
    if (hops > 3) report.warn('chain.too-long', `节点「${nodeById.get(nid)!.node.name}」的前置链有 ${hops} 跳`, nid);
  }
}
