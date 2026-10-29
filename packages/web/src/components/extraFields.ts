import { parse, stringify } from 'yaml';

export function formatExtraValue(value: unknown): string {
  return stringify(value, { collectionStyle: 'flow', lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' }).trimEnd();
}

export function parseExtraValue(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 新增和重命名共用校验，外部可限制业务保留字段。 */
export function extraNameError(value: Record<string, unknown>, name: string, previous?: string, validateName?: (name: string) => string | undefined): string | undefined {
  if (!name || (name !== previous && Object.hasOwn(value, name))) return '请填写未使用的字段名称';
  return validateName?.(name);
}
