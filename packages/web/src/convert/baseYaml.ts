import { isMap, LineCounter, stringify } from 'yaml';
import { parseYamlDocument } from './yamlDocument.ts';
import type { RawResult } from '../components/DualEditor.tsx';
import { getPath, isRecord, setPath, type FieldGroup } from '../components/schema.ts';
import { mihomoBaseGroups } from '../schemas/mihomoBase.ts';
import { recoverFields, recoverYaml } from './recoverYaml.ts';

export function baseFormFromYaml(text: string, groups: FieldGroup[] = mihomoBaseGroups) {
  const recovered = recoverYaml(text);
  const notes = recovered.notes;
  let value = recoverFields(recovered.value, groups, notes);
  const path = 'dns.nameserver-policy';
  const policy = getPath(value, path);
  if (isRecord(policy)) value = setPath(value, path, Object.fromEntries(Object.entries(policy).flatMap<[string, unknown]>(([key, item]) => {
    if (typeof item === 'string') return [[key, item]];
    if (Array.isArray(item)) return [[key, item.filter((server, index) => {
      if (typeof server === 'string') return true;
      notes.push(`已忽略 ${path}.${key}[${index + 1}]：需要字符串`);
      return false;
    })]];
    notes.push(`已忽略 ${path}.${key}：需要字符串或字符串列表`);
    return [];
  })));
  return { value, notes };
}

export function baseToYaml(obj: Record<string, unknown>): string {
  return stringify(obj, { lineWidth: 0 });
}

export function baseFromYaml(text: string): RawResult<Record<string, unknown>> {
  const lineCounter = new LineCounter();
  let line = 1;
  try {
    const doc = parseYamlDocument(text, { lineCounter });
    const error = doc.errors[0];
    if (error) return { ok: false, error: `YAML 解析失败：${error.message}`, line: error.linePos?.[0]?.line ?? 1 };
    if (doc.contents?.range) line = lineCounter.linePos(doc.contents.range[0]).line;
    if (!isMap(doc.contents)) return { ok: false, error: 'YAML 顶层必须是映射', line };
    return { ok: true, value: doc.toJS() as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`, line };
  }
}
