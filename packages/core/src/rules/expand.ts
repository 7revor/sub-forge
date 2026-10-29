// 规则集展开（docs/03 §3 ④、§6）：逐个来源解析并应用组级内容改写，再按 behavior 拆分、去重。

import type { Report } from '../report.ts';
import type { ID, RuleIR, RuleSet, RuleSetSource } from '../types.ts';
import { applyOverrides, lowerRule, withIpOptions, type ClientCtx } from './client.ts';
import { behaviorOf, parseRuleSetContent, ruleKey, type Behavior } from './parse.ts';

export type RuleSetInputs = {
  rulesets: Record<ID, RuleSet>;
  /** 远程来源的快照正文，键为 sourceKey(规则集 id, 来源 id)；本地来源读 content */
  snapshots: Record<string, string>;
};

/** 远程来源快照在渲染输入里的键 */
export const sourceKey = (rulesetId: ID, sourceId: ID): string => `${rulesetId}/${sourceId}`;

/** 来源的显示名：缺省用 URL 或「本地规则」 */
export const sourceLabel = (src: RuleSetSource): string => src.name?.trim() || (src.kind === 'remote' ? src.url ?? '远程地址' : '本地规则');

export type ExpandedSource =
  | { passthrough: false; rules: RuleIR[] }
  | { passthrough: true; format: 'mrs' | 'srs'; url?: string };

/** 展开单个来源：解析 + 组级内容改写（兼容旧来源覆盖）。结果按 ctx 区分 */
export function expandSource(rs: RuleSet, src: RuleSetSource, inputs: RuleSetInputs, ctx: ClientCtx, report: Report): ExpandedSource {
  const where = `ruleset:${rs.id}`;
  const label = `规则集「${rs.name}」的来源「${sourceLabel(src)}」`;
  const body = src.kind === 'local' ? src.content ?? '' : inputs.snapshots[sourceKey(rs.id, src.id)];
  const passthrough = (format: 'mrs' | 'srs'): ExpandedSource => (src.url ? { passthrough: true, format, url: src.url } : { passthrough: true, format });
  if (body === undefined) {
    if (src.format === 'mrs' || src.format === 'srs') return passthrough(src.format);
    report.error('ruleset.no-snapshot', `${label}没有可用快照`, where);
    return { passthrough: false, rules: [] };
  }
  const parsed = parseRuleSetContent(body, src.format, src.behavior);
  if (parsed.passthrough) return passthrough(parsed.format);
  // 旧版本可能已经把错误页面保存为成功快照；读取时也要阻止这些内容变成空分流配置。
  // 此处在客户端覆盖之前检查，显式 drop 所有规则仍是合法操作。
  if (src.kind === 'remote' && !parsed.rules.length) {
    report.error('ruleset.invalid-content', `${label}的远程快照没有可用规则，请重新拉取`, where);
    return { passthrough: false, rules: [] };
  }
  if (parsed.rejected.length) {
    report.info('ruleset.rejected-lines', `${label}有 ${parsed.rejected.length} 行无法解析或不支持`, where);
  }
  const rules: RuleIR[] = [];
  for (const p of parsed.rules) {
    const group = rs.overrides?.filter((o) => o.match === p.text).map((o) => o.override) ?? [];
    const ov = src.overrides?.filter((o) => (o.line !== undefined && o.line === p.line) || (o.match !== undefined && o.match === p.text)).map((o) => o.override);
    rules.push(...applyOverrides(p.rule, [...group, ...(ov ?? [])], ctx));
  }
  return { passthrough: false, rules };
}

export type PassthroughSource = { sourceId: ID; name: string; format: 'mrs' | 'srs'; url?: string; behavior?: Behavior };
export type RuleSetBuckets = Record<Behavior, RuleIR[]> & {
  passthrough: PassthroughSource[];
  /** 启用来源展开后的总条数与去重条数（界面统计用） */
  total: number;
  duplicates: number;
};

/**
 * 展开规则集（RS-04 / RB-03）：合并全部启用的来源，按 behavior 分桶并去重。
 * 输出顺序由调用方按 domain → classical → ipcidr 排列。
 */
export function expandRuleSet(id: ID, inputs: RuleSetInputs, ctx: ClientCtx, report: Report): RuleSetBuckets {
  const out: RuleSetBuckets = { domain: [], classical: [], ipcidr: [], passthrough: [], total: 0, duplicates: 0 };
  const rs = inputs.rulesets[id];
  if (!rs) { report.error('ruleset.missing', '规则集不存在', `ruleset:${id}`); return out; }
  const seen = new Set<string>();
  for (const src of rs.sources) {
    if (src.enabled === false) continue;
    const ex = expandSource(rs, src, inputs, ctx, report);
    if (ex.passthrough) {
      out.passthrough.push({ sourceId: src.id, name: sourceLabel(src), format: ex.format, ...(ex.url ? { url: ex.url } : {}), ...(src.behavior ? { behavior: src.behavior } : {}) });
      continue;
    }
    for (let r of ex.rules) {
      r = withIpOptions(r, { noResolve: rs.noResolve });
      out.total++;
      const k = ruleKey(r);
      if (seen.has(k)) { out.duplicates++; continue; }
      seen.add(k);
      out[behaviorOf(r)].push(r);
    }
  }
  return out;
}

/**
 * 规则的 classical 文本（mihomo 写法，可被 parseRuleLine 读回）。
 * 用于把旧规则包里的单条规则迁移成本地来源。
 */
export function formatRuleLine(rule: RuleIR): string {
  if (rule.type === 'RAW') return rule.text;
  const l = lowerRule(rule, { client: 'mihomo' });
  if (l.kind === 'drop') return `# ${l.reason}`;
  return [l.text, ...(l.noResolve ? ['no-resolve'] : []), ...(l.src ? ['src'] : [])].join(',');
}
