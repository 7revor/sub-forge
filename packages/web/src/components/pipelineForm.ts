import { applyOperator, compileUserRegex } from '@sub-forge/core';

export function setFieldsError(fields: Record<string, unknown>): string | undefined {
  try { applyOperator({ op: 'set', fields }, []); }
  catch (error) { return (error as Error).message; }
  return undefined;
}

export function regexError(pattern: string, flags = ''): string | undefined {
  try { compileUserRegex(pattern, flags); }
  catch (error) { return (error as Error).message; }
  return undefined;
}

export function updateSetField(fields: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...fields };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}
