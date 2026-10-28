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
