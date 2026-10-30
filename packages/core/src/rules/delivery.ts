import type { RuleEntry, RuleSet } from '../types.ts';
import type { ClientCtx } from './client.ts';

/** 全局托管；这里只检查目标输出是否可生成，不再选择上游直连。 */
export type RuleSetDelivery =
  | { mode: 'managed'; format: 'text'; behavior: 'classical' }
  | { mode: 'managed'; format: 'mrs'; behavior: 'domain' | 'ipcidr' }
  | { mode: 'unsupported'; reason: string };

export function managedRuleDelivery(rs: RuleSet, ctx: ClientCtx, options?: RuleEntry['options']): RuleSetDelivery {
  const sources = rs.sources.filter(s => s.enabled !== false);
  if (!sources.some(s => s.format === 'mrs' || s.format === 'srs')) return { mode: 'managed', format: 'text', behavior: 'classical' };
  const src = sources[0];
  if (sources.length !== 1 || !src || src.format !== 'mrs' || !['domain', 'ipcidr'].includes(src.behavior ?? '') || rs.overrides?.length || src.overrides?.length || options?.src) {
    return { mode: 'unsupported', reason: 'MRS 需要单一有效来源且无法合并或改写；SRS 暂不支持托管' };
  }
  if (ctx.client !== 'mihomo' && ctx.client !== 'stash') return { mode: 'unsupported', reason: '目标客户端不支持 MRS 托管，请使用文本来源' };
  return { mode: 'managed', format: 'mrs', behavior: src.behavior as 'domain' | 'ipcidr' };
}
