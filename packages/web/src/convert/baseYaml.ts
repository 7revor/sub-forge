import { isMap, LineCounter, parseDocument, stringify } from 'yaml';
import type { RawResult } from '../components/DualEditor.tsx';

export function baseToYaml(obj: Record<string, unknown>): string {
  return stringify(obj, { lineWidth: 0 });
}

export function baseFromYaml(text: string): RawResult<Record<string, unknown>> {
  const lineCounter = new LineCounter();
  let line = 1;
  try {
    const doc = parseDocument(text, { lineCounter });
    const error = doc.errors[0];
    if (error) return { ok: false, error: `YAML 解析失败：${error.message}`, line: error.linePos?.[0]?.line ?? 1 };
    if (doc.contents?.range) line = lineCounter.linePos(doc.contents.range[0]).line;
    if (!isMap(doc.contents)) return { ok: false, error: 'YAML 顶层必须是映射', line };
    return { ok: true, value: doc.toJS() as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`, line };
  }
}
