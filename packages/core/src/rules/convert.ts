// 通用规则转换：保留来源行位，诊断写成注释；由服务端预览和托管文件共同调用，不做 I/O。
import { isNode, isSeq, LineCounter, parseDocument } from 'yaml';
import type { ClientOverride, RuleIR, RuleSet, RuleSetSource } from '../types.ts';
import { composeRule, lowerRule, withIpOptions, type ClientCtx } from './client.ts';
import { behaviorOf, parseRuleSourceContent, ruleKey, type Behavior, type ParsedRule } from './parse.ts';

export type RuleDiagnostic = { sourceId: string; line: number; text: string; reason: string; kind: 'invalid' | 'unimplemented' | 'client' | 'override' | 'duplicate' | 'degraded' };
export type RuleDocumentRow = { line: number; text: string; parsed?: ParsedRule; diagnostic?: RuleDiagnostic };
export type RuleDocument = {
  sourceId: string; rows: RuleDocumentRow[]; diagnostics: RuleDiagnostic[]; parsed: number;
  format: string; behavior?: Behavior; passthrough: boolean;
};
export type RuleConversion = {
  lines: string[];
  origins: { sourceId: string; line: number }[];
  diagnostics: RuleDiagnostic[];
  stats: { parsed: number; rejected: number; output: number; duplicates: number; removed: number; replaced: number; appended: number; unsupported: number; degraded: number; domain: number; classical: number; ipcidr: number };
};
const oneLine = (text: string) => text.replace(/[\r\n\u2028\u2029]/g, ' ');
const comment = (reason: string, text: string) => `# [${oneLine(reason)}] ${oneLine(text)}`;

/** 文本保留物理行；YAML 结构行变为注释，payload 仍携带实际源文件行号。 */
export function prepareRuleDocument(content: string, source: RuleSetSource): RuleDocument {
  const rows: RuleDocumentRow[] = content.split(/\r?\n/).map((text, i) => ({ line: i + 1, text }));
  // 末尾换行是结束符，不额外制造一行。
  if (rows.length > 1 && rows.at(-1)!.text === '') rows.pop();
  const result: RuleDocument = { sourceId: source.id, rows, diagnostics: [], parsed: 0, format: 'auto', passthrough: false };
  try {
    const parsed = parseRuleSourceContent(content, source);
    result.format = parsed.format;
    result.passthrough = parsed.passthrough;
    if (parsed.passthrough) { result.rows = []; return result; }
    result.behavior = parsed.behavior;
    result.parsed = parsed.rules.length;
    let yamlLines: number[] | undefined;
    if (parsed.format === 'yaml') {
      const lineCounter = new LineCounter();
      const doc = parseDocument(content, { lineCounter });
      const payload = doc.get('payload', true);
      if (isSeq(payload)) yamlLines = payload.items.map(item => lineCounter.linePos((isNode(item) ? item.range?.[0] : undefined) ?? 0).line);
      // YAML 标记不能成为 LIST 中的可执行规则。
      for (const row of rows) row.text = row.text.trim() ? comment('YAML 原文', row.text) : '';
    }
    const byLine = new Map(rows.map(row => [row.line, row]));
    const extras = new Map<number, RuleDocumentRow[]>();
    const attach = (line: number, text: string, value: Pick<RuleDocumentRow, 'parsed' | 'diagnostic'>) => {
      const actual = yamlLines?.[line - 1] ?? line;
      const candidate = byLine.get(actual);
      const row = candidate && !candidate.parsed && !candidate.diagnostic ? candidate : undefined;
      const entry = { line: actual, text, ...value };
      if (entry.diagnostic) entry.diagnostic.line = actual;
      if (row) Object.assign(row, entry);
      else {
        // 流式 YAML 一行可含多条规则，扩展为固定逻辑行，原始定位保持不变。
        extras.set(actual, [...(extras.get(actual) ?? []), entry]);
      }
    };
    const entries = [...parsed.rules.map(p => ({ p, valid: true })), ...parsed.rejected.map(p => ({ p, valid: false }))].sort((a, b) => a.p.line - b.p.line);
    for (const { p, valid } of entries) {
      if (valid && 'rule' in p) attach(p.line, p.text, { parsed: p });
      else if ('reason' in p) {
        const diagnostic: RuleDiagnostic = { ...p, sourceId: source.id, kind: p.kind };
        result.diagnostics.push(diagnostic);
        attach(p.line, p.text, { diagnostic });
      }
    }
    result.rows = rows.flatMap(row => [row, ...(extras.get(row.line) ?? [])]);

  } catch (cause) {
    const reason = `输入格式有误：${cause instanceof Error ? cause.message : String(cause)}`;
    for (const row of rows) {
      if (!row.text.trim()) continue;
      const diagnostic: RuleDiagnostic = { sourceId: source.id, line: row.line, text: row.text, reason, kind: 'invalid' };
      row.diagnostic = diagnostic;
      result.diagnostics.push(diagnostic);
    }
  }
  return result;
}

export function convertRuleDocuments(
  rs: RuleSet, documents: ReadonlyMap<string, RuleDocument>, ctx: ClientCtx,
  options: { sourceId?: string; ipOptions?: { noResolve?: boolean; src?: boolean } } = {},
): RuleConversion {
  const out: RuleConversion = { lines: [], origins: [], diagnostics: [], stats: { parsed: 0, rejected: 0, output: 0, duplicates: 0, removed: 0, replaced: 0, appended: 0, unsupported: 0, degraded: 0, domain: 0, classical: 0, ipcidr: 0 } };
  const seen = new Set<string>();
  const matches = (o: ClientOverride) => o.when.client === ctx.client && (o.when.platform === undefined || o.when.platform === ctx.platform);
  const push = (text: string, sourceId: string, line: number) => { out.lines.push(text); out.origins.push({ sourceId, line }); };
  const emit = (rule: RuleIR, sourceId: string, line: number, text: string) => {
    const r = withIpOptions(rule, options.ipOptions ?? {});
    const k = ruleKey(r, ctx.client);
    const issue = (kind: RuleDiagnostic['kind'], reason: string) => { out.diagnostics.push({ sourceId, line, text, kind, reason }); push(comment(reason, text), sourceId, line); };
    if (!options.sourceId && seen.has(k)) { out.stats.duplicates++; issue('duplicate', '重复规则'); return; }
    seen.add(k);
    const lowered = lowerRule(r, ctx);
    if (lowered.kind === 'drop') { out.stats.unsupported++; issue('client', `当前客户端无法输出：${lowered.reason}`); return; }
    const rendered = composeRule(lowered);
    if (/[\r\n\u2028\u2029]/.test(rendered)) { out.stats.unsupported++; issue('client', '规则包含换行，无法安全输出'); return; }
    if (lowered.note) { out.stats.degraded++; out.diagnostics.push({ sourceId, line, text, kind: 'degraded', reason: lowered.note }); }
    out.stats.output++;
    out.stats[behaviorOf(r)]++;
    push(rendered, sourceId, line);
  };
  for (const src of rs.sources) {
    if (options.sourceId ? src.id !== options.sourceId : src.enabled === false) continue;
    const doc = documents.get(src.id);
    if (!doc || doc.passthrough) continue;
    out.stats.parsed += doc.parsed;
    out.stats.rejected += doc.diagnostics.length;
    out.diagnostics.push(...doc.diagnostics);
    for (const row of doc.rows) {
      if (row.diagnostic) {
        push(comment(row.diagnostic.kind === 'unimplemented' ? `本系统暂未支持解析：${row.diagnostic.reason}` : `输入格式有误：${row.diagnostic.reason}`, row.text), src.id, row.line);
        continue;
      }
      if (!row.parsed) {
        const text = row.text.trim();
        push(!text || text.startsWith('#') ? row.text : comment('原文注释', row.text), src.id, row.line);
        continue;
      }
      const p = row.parsed;
      const overrides = [
        ...(rs.overrides ?? []).filter(o => !('append' in o.override.action) && o.match === p.text).map(o => o.override),
        ...(src.overrides ?? []).filter(o => o.line === p.line || o.match === p.text).map(o => o.override),
      ];
      const hit = overrides.find(matches);
      const width = Math.max(1, ...overrides.map(o => 'replace' in o.action ? o.action.replace.length : 'append' in o.action ? o.action.append.length + 1 : 1));
      const rules = !hit ? [p.rule] : 'drop' in hit.action ? [] : 'replace' in hit.action ? hit.action.replace : [p.rule, ...hit.action.append];
      if (hit && 'drop' in hit.action) {
        out.stats.removed++;
        out.diagnostics.push({ sourceId: src.id, line: row.line, text: row.text, kind: 'override', reason: '客户端改写移除' });
      }
      if (hit && 'replace' in hit.action) out.stats.replaced++;
      if (hit && 'append' in hit.action) out.stats.appended += hit.action.append.length;
      for (let i = 0; i < width; i++) {
        if (rules[i]) emit(rules[i]!, src.id, row.line, i === 0 ? row.text : composeForComment(rules[i]!));
        else push(comment(i === 0 ? '客户端改写移除' : '改写预留行', i === 0 ? row.text : ''), src.id, row.line);
      }
    }
  }
  // 为所有客户端的追加配置保留相同位置；不命中的追加写注释。
  if (!options.sourceId) for (const [index, { override }] of (rs.overrides ?? []).entries()) {
    if (!('append' in override.action)) continue;
    const active = matches(override);
    for (const r of override.action.append) {
      if (active) { out.stats.appended++; emit(r, '$append', index + 1, composeForComment(r)); }
      else push(comment('追加未匹配当前客户端', composeForComment(r)), '$append', index + 1);
    }
  }
  return out;
}

function composeForComment(rule: RuleIR): string {
  if (rule.type === 'RAW') return oneLine(rule.text);
  const lowered = lowerRule(rule, { client: 'mihomo' });
  return lowered.kind === 'ok' ? composeRule(lowered) : JSON.stringify(rule);
}
