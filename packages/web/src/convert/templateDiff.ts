import type { GroupSpec, RuleEntry } from '@sub-forge/core';
import type { TemplateBody } from './templateYaml.ts';

export type FieldChange = { field: string; before: unknown; after: unknown };
export type EntityDiff<T> = {
  added: T[]; removed: T[];
  modified: { id: string; before: T; after: T; fields: FieldChange[] }[];
  moved: { id: string; before: number; after: number }[];
};
export type TemplateChanges = {
  groups: EntityDiff<GroupSpec>; rules: EntityDiff<RuleEntry>;
  final?: { before: TemplateBody['final']; after: TemplateBody['final'] };
};

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (record(a) && record(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => equal(a[key], b[key]));
  return false;
}

function fields(before: unknown, after: unknown, prefix = ''): FieldChange[] {
  if (equal(before, after)) return [];
  if (record(before) && record(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .flatMap((key) => fields(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  return [{ field: prefix, before, after }];
}

/** 按稳定 ID 对齐；增删造成的位置平移不算移动，保留项的相对顺序变化才算。 */
function entities<T extends { id: string }>(before: T[], after: T[]): EntityDiff<T> {
  const old = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  const oldCommon = before.filter((item) => next.has(item.id)).map((item) => item.id);
  const newCommon = after.filter((item) => old.has(item.id)).map((item) => item.id);
  return {
    added: after.filter((item) => !old.has(item.id)),
    removed: before.filter((item) => !next.has(item.id)),
    modified: after.flatMap((item) => {
      const previous = old.get(item.id);
      if (!previous) return [];
      const changes = fields(previous, item);
      return changes.length ? [{ id: item.id, before: previous, after: item, fields: changes }] : [];
    }),
    moved: newCommon.filter((id, i) => oldCommon.indexOf(id) !== i).map((id) => ({
      id, before: before.findIndex((item) => item.id === id), after: after.findIndex((item) => item.id === id),
    })),
  };
}

export function templateDiff(before: TemplateBody, after: TemplateBody): TemplateChanges {
  return {
    groups: entities(before.groups, after.groups), rules: entities(before.rules, after.rules),
    ...(equal(before.final, after.final) ? {} : { final: { before: before.final, after: after.final } }),
  };
}
