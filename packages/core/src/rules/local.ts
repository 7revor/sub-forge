import type { Matcher, RuleIR } from '../types.ts';
import type { ClientCtx } from './client.ts';
import { rawRuleError } from './raw.ts';

export type LocalMatcher = Extract<Matcher, { kind: 'local' }>;

/** 保留原文用于编辑；空行和整行注释不参与输出，不改变规则顺序或去重。 */
export function localRuleLines(content: string): { line: number; text: string }[] {
  return content.split(/\r?\n/).flatMap((text, index) => {
    const value = text.trim();
    return !value || value.startsWith('#') ? [] : [{ line: index + 1, text: value }];
  });
}

export function localRulesError(value: { content?: unknown; client?: unknown }): string | undefined {
  if (typeof value.content !== 'string') return '本地规则内容必须是文本';
  if (value.client !== undefined && !['mihomo', 'surge', 'stash', 'loon'].includes(String(value.client))) return '本地规则客户端不合法';
  const lines = localRuleLines(value.content);
  if (!lines.length) return '请填写至少一条本地规则';
  for (const { line, text } of lines) {
    const error = rawRuleError(text);
    if (error) return `第 ${line} 行：${error}`;
  }
  return undefined;
}

/** 覆盖作用于整张卡片：替换整组、末尾追加一次，或丢弃整组。 */
export function expandLocalRules(matcher: LocalMatcher, ctx?: ClientCtx): RuleIR[] {
  const error = localRulesError(matcher);
  if (error) throw new Error(error);
  const rules: RuleIR[] = localRuleLines(matcher.content).map(({ text }) => ({ type: 'RAW', text, ...(matcher.client ? { client: matcher.client } : {}) }));
  const hit = ctx && matcher.overrides?.find(o => o.when.client === ctx.client && (o.when.platform === undefined || o.when.platform === ctx.platform));
  return !hit ? rules : 'drop' in hit.action ? [] : 'append' in hit.action ? [...rules, ...hit.action.append] : hit.action.replace;
}
