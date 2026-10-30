export type FieldSpec = {
  key: string;
  label: string;
  type: 'bool' | 'number' | 'string' | 'enum' | 'lines' | 'kv';
  options?: string[];
  hint?: string;
  placeholder: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  clients?: import('@sub-forge/core').Client[];
  showIf?: (obj: Record<string, unknown>) => boolean;
};
export type FieldGroup = { title: string; fields: FieldSpec[] };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function getPath(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) =>
    isRecord(value) && Object.hasOwn(value, part) ? value[part] : undefined, obj);
}

export function setPath(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  if (parts.some((part) => !part || ['__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new Error('字段路径不能为空或包含保留名称');
  }
  const update = (source: Record<string, unknown>, index: number): Record<string, unknown> => {
    const part = parts[index]!;
    const result = { ...source };
    if (index === parts.length - 1) {
      if (value === undefined) delete result[part];
      else result[part] = value;
    } else {
      if (!isRecord(source[part]) && value === undefined) return source;
      const child = update(isRecord(source[part]) ? source[part] : {}, index + 1);
      if (Object.keys(child).length) result[part] = child;
      else delete result[part];
    }
    return result;
  };
  return update(obj, 0);
}

export function knownKeys(groups: FieldGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.fields.map((field) => field.key)));
}

/** 返回嵌套对象；只有存在已知子路径时才拆开比较，其他对象完整保留。 */
export function otherFields(obj: Record<string, unknown>, groups: FieldGroup[]): Record<string, unknown> {
  const keys = [...knownKeys(groups)];
  const visit = (source: Record<string, unknown>, prefix: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (keys.includes(path)) return [];
      if (isRecord(value) && keys.some((known) => known.startsWith(`${path}.`))) {
        const rest = visit(value, path);
        return Object.keys(rest).length ? [[key, rest]] : [];
      }
      return [[key, value]];
    }));
  return visit(obj, '');
}

/** 替换其他字段时恢复已知路径，包括条件隐藏的字段。 */
export function replaceOtherFields(obj: Record<string, unknown>, extra: Record<string, unknown>, groups: FieldGroup[]) {
  let result = otherFields(extra, groups);
  for (const key of knownKeys(groups)) {
    const value = getPath(obj, key);
    if (value !== undefined) result = setPath(result, key, value);
  }
  return result;
}
