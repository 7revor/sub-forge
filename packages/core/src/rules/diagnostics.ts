import type { ReportItem } from '../report.ts';
import type { RuleSetSource } from '../types.ts';
import { prepareRuleDocument } from './convert.ts';

/** 使用源文件物理行号，避免把 YAML 条目序号误报为行号。 */
export function rejectedRuleReport(content: string, source: RuleSetSource, sourceIndex: number): Pick<ReportItem, 'message' | 'ruleIssues'> {
  const document = prepareRuleDocument(content, source);
  const ruleIssues: NonNullable<ReportItem['ruleIssues']> = document.diagnostics
    .filter(d => d.kind === 'invalid' || d.kind === 'unimplemented')
    .map(d => ({ source: sourceIndex + 1, line: d.line, kind: d.kind as 'invalid' | 'unimplemented', reason: d.reason }));
  const unsupported = ruleIssues.filter(d => d.kind === 'unimplemented').length;
  const invalid = ruleIssues.length - unsupported;
  const message = [unsupported ? `类型不支持：${unsupported} 行` : '', invalid ? `写法有误：${invalid} 行` : ''].filter(Boolean).join(' · ');
  return { message, ruleIssues };
}
