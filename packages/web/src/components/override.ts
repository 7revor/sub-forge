import { getPath, isRecord } from './schema.ts';

export function isOverridden(patch: Record<string, unknown>, key: string): boolean {
  const parts = key.split('.');
  let value: unknown = patch;
  for (const part of parts) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return false;
    value = value[part];
  }
  return value !== undefined;
}

export function overrideValue(base: Record<string, unknown>, patch: Record<string, unknown>, key: string): unknown {
  return getPath(isOverridden(patch, key) ? patch : base, key);
}
