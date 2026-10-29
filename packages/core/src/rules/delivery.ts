import type { RuleDocument } from './convert.ts';
// 预览与实际下载共用输出决策，不能因直连而跳过合并、改写或规则级选项。
import type { RuleSet, RuleEntry } from '../types.ts';
import { composeRule, lowerRule, type ClientCtx } from './client.ts';
import { sourceKey, type RuleSetInputs } from './expand.ts';
import { parseRuleSourceContent, type Behavior } from './parse.ts';

export type RuleSetDelivery =
  | { mode: 'original'; format: 'text' | 'yaml' | 'mrs'; behavior: Behavior; url: string }
  | { mode: 'managed'; format: 'text'; behavior: 'classical' }
  | { mode: 'unsupported'; reason: string };

export function ruleSetDelivery(rs: RuleSet, inputs: RuleSetInputs, ctx: ClientCtx, options?: RuleEntry['options'], prepared?: ReadonlyMap<string, RuleDocument>): RuleSetDelivery {
  const managed: RuleSetDelivery = { mode: 'managed', format: 'text', behavior: 'classical' };
  const sources = rs.sources.filter(s => s.enabled !== false);
  const binary = sources.some(s => s.format === 'mrs' || s.format === 'srs');
  const src = sources[0];
  const changed = sources.length !== 1 || !!rs.overrides?.length || !!rs.noResolve || !!options?.noResolve || !!options?.src || sources.some(s => s.overrides?.length);
  if (changed || !src || src.kind !== 'remote' || !src.url) {
    return binary ? { mode: 'unsupported', reason: '二进制规则无法合并或改写，请使用对应的文本规则来源' } : managed;
  }
  // 自定义拉取身份不能丢失；此类来源继续由服务端读取并托管。
  const fetch = 'fetch' in src ? src.fetch as { ua?: string } | undefined : undefined;
  if (fetch?.ua) return binary ? { mode: 'unsupported', reason: '二进制规则无法使用服务端自定义拉取设置' } : managed;
  if (binary) {
    return ctx.client === 'mihomo' && src.format === 'mrs' && (src.behavior === 'domain' || src.behavior === 'ipcidr')
      ? { mode: 'original', format: 'mrs', behavior: src.behavior, url: src.url }
      : { mode: 'unsupported', reason: '目标客户端不支持该二进制规则，无法转换为 LIST' };
  }
  const body = inputs.snapshots[sourceKey(rs.id, src.id)];
  if (body === undefined) return managed;
  const document = prepared?.get(src.id);
  const parsed = document ? {
    passthrough: document.passthrough, format: document.format, behavior: document.behavior ?? 'classical',
    rules: document.rows.flatMap(row => row.parsed ? [row.parsed] : []), rejected: document.diagnostics,
  } : parseRuleSourceContent(body, src);
  if (parsed.passthrough || !parsed.rules.length || parsed.rejected.length) return managed;
  if (parsed.format === 'yaml' && ctx.client !== 'mihomo') return managed;
  if (parsed.behavior === 'ipcidr' && ctx.client !== 'mihomo') return managed;
  // DOMAIN-SET 的前导点在 Clash 中语义不同；纯域名可以直接引用，其余必须转换。
  if (parsed.behavior === 'domain') {
    if (ctx.client === 'mihomo' && parsed.format !== 'yaml' && src.format !== 'domain' && !src.repository?.path.startsWith('rule/Clash/') && parsed.rules.some(p => p.text.startsWith('.'))) return managed;
    if (ctx.client === 'surge' && parsed.rules.some(p => p.text.startsWith('+.') || p.rule.type === 'DOMAIN-WILDCARD')) return managed;
  } else if (parsed.behavior === 'classical') {
    // 需要别名翻译、平台降级或丢弃的内容不能原样下发。
    for (const p of parsed.rules) {
      const lowered = lowerRule(p.rule, ctx);
      if (lowered.kind === 'drop' || lowered.note || composeRule(lowered) !== p.text.split(',').map(x => x.trim()).join(',')) return managed;
    }
  }
  // Clash 文本不支持分号注释；转换时由解析器清理。
  if (parsed.format !== 'yaml' && body.split(/\r?\n/).some(line => line.trim().startsWith(';'))) return managed;
  return { mode: 'original', format: parsed.format === 'yaml' ? 'yaml' : 'text', behavior: parsed.behavior, url: src.url };
}
