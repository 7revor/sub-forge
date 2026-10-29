import { TESTABLE_PROXY_TYPES, validateLocalProxy, type LocalProxy } from '@sub-forge/core';
import { LineCounter } from 'yaml';
import { parseYamlDocument } from './yamlDocument.ts';
import type { RawResult } from '../components/DualEditor.tsx';

export function inspectLocalNodeYaml(text: string): RawResult<LocalProxy> {
  const lines = new LineCounter();
  try {
    if (!text.trim()) return { ok: false, error: '请输入或粘贴节点配置' };
    const doc = parseYamlDocument(text, { lineCounter: lines });
    const syntax = doc.errors[0] ?? doc.warnings[0];
    if (syntax) return { ok: false, error: syntax.message, line: lines.linePos(syntax.pos[0]).line };
    const value: unknown = doc.toJS({ maxAliasCount: 100 });
    // 循环引用不能持久化为节点对象，避免把最后一次有效草稿误当作当前输入。
    JSON.stringify(value);
    const issue = validateLocalProxy(value)[0];
    if (issue) {
      const field = doc.get(issue.field, true);
      const offset = field && typeof field === 'object' && 'range' in field ? (field.range as number[] | null)?.[0] : undefined;
      return { ok: false, error: issue.message, ...(offset === undefined ? {} : { line: lines.linePos(offset).line }) };
    }
    const node = value as LocalProxy;
    return { ok: true, value: node, notes: (TESTABLE_PROXY_TYPES as readonly string[]).includes(node.type) ? [] : ['此协议仅完成基础字段校验，需在实际客户端验证兼容性。'] };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? '配置包含循环引用，无法保存' : error instanceof Error ? error.message : String(error) };
  }
}

/** 保留注释和扩展字段，仅在用户明确点击格式化时修改排版。 */
export function formatLocalNodeYaml(text: string): string {
  const doc = parseYamlDocument(text);
  if (doc.errors.length) throw doc.errors[0];
  return doc.toString();
}
