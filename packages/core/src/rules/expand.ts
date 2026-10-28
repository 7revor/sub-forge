// 规则集 / 规则包展开（docs/03 §3 ④、§6）：应用行级覆盖、按 behavior 拆分、去重。

import type { Report } from '../report.ts';
import type { ID, RuleBundle, RuleIR, RuleSet } from '../types.ts';
import { applyOverrides, type ClientCtx } from './client.ts';
import { behaviorOf, parseRuleSetContent, ruleKey, type Behavior } from './parse.ts';

export type RuleSetInputs = {
  rulesets: Record<ID, RuleSet>;
  bundles: Record<ID, RuleBundle>;
  /** 远程规则集的快照正文；本地规则集读 content */
  snapshots: Record<ID, string>;
};

export type ExpandedRuleSet =
  | { passthrough: false; rules: RuleIR[] }
  | { passthrough: true; format: 'mrs' | 'srs'; url?: string };

/** 展开单个规则集：解析 + 行级客户端覆盖。结果按 ctx 区分 */
export function expandRuleSet(id: ID, inputs: RuleSetInputs, ctx: ClientCtx, report: Report): ExpandedRuleSet {
  const rs = inputs.rulesets[id];
  const where = `ruleset:${id}`;
  if (!rs) { report.error('ruleset.missing', '规则集不存在', where); return { passthrough: false, rules: [] }; }
  const body = rs.kind === 'local' ? rs.content ?? '' : inputs.snapshots[id];
  if (body === undefined) {
    if (rs.format === 'mrs' || rs.format === 'srs') return rs.url ? { passthrough: true, format: rs.format, url: rs.url } : { passthrough: true, format: rs.format };
    report.error('ruleset.no-snapshot', `规则集「${rs.name}」没有可用快照`, where);
    return { passthrough: false, rules: [] };
  }
  const parsed = parseRuleSetContent(body, rs.format);
  if (parsed.passthrough) return rs.url ? { passthrough: true, format: parsed.format, url: rs.url } : { passthrough: true, format: parsed.format };
  if (parsed.rejected.length) {
    report.info('ruleset.rejected-lines', `规则集「${rs.name}」有 ${parsed.rejected.length} 行无法解析或不支持`, where);
  }
  const rules: RuleIR[] = [];
  for (const p of parsed.rules) {
    const ov = rs.overrides?.filter((o) => (o.line !== undefined && o.line === p.line) || (o.match !== undefined && o.match === p.text)).map((o) => o.override);
    rules.push(...applyOverrides(p.rule, ov, ctx));
  }
  return { passthrough: false, rules };
}

export type BundleBuckets = Record<Behavior, RuleIR[]> & { passthrough: { id: ID; format: 'mrs' | 'srs'; url?: string }[] };

/**
 * 展开规则包（RB-01 / RB-03）：最多两层；按 behavior 分桶并去重。
 * 输出顺序由调用方按 domain → classical → ipcidr 排列。
 */
export function expandBundle(id: ID, inputs: RuleSetInputs, ctx: ClientCtx, report: Report): BundleBuckets {
  const out: BundleBuckets = { domain: [], classical: [], ipcidr: [], passthrough: [] };
  const bundle = inputs.bundles[id];
  const where = `bundle:${id}`;
  if (!bundle) { report.error('bundle.missing', '规则包不存在', where); return out; }
  const seen = new Set<string>();
  const push = (r: RuleIR) => {
    const k = ruleKey(r);
    if (seen.has(k)) return;
    seen.add(k);
    const b = behaviorOf(r);
    if (b === 'ipcidr' && bundle.noResolve && (r.type === 'IP-CIDR' || r.type === 'IP-CIDR6')) out[b].push({ ...r, noResolve: true });
    else out[b].push(r);
  };
  for (const item of bundle.items) {
    if (item.enabled === false) continue;
    if (item.kind === 'rule') { push(item.rule); continue; }
    if ((item as { kind: string }).kind === 'bundle') { report.error('bundle.nested', '规则包不能包含规则包（最多两层）', where); continue; }
    const ex = expandRuleSet(item.id, inputs, ctx, report);
    if (ex.passthrough) out.passthrough.push(ex.url ? { id: item.id, format: ex.format, url: ex.url } : { id: item.id, format: ex.format });
    else ex.rules.forEach(push);
  }
  return out;
}
