import type { Overlay } from '@sub-forge/core';

/** 按有效顺序重建相邻锚点，确保内核逐项插入时，私有组锚点已存在。 */
export function reorderExtraGroups(
  templateIds: readonly string[],
  targetIds: readonly string[],
  extraGroups: NonNullable<Overlay['extraGroups']>,
): NonNullable<Overlay['extraGroups']> {
  const templateSet = new Set(templateIds);
  const extras = new Map(extraGroups.map((entry) => [entry.group.id, entry]));
  const expected = [...templateIds, ...extras.keys()];
  if (new Set(expected).size !== expected.length || extras.size !== extraGroups.length
    || new Set(targetIds).size !== targetIds.length || targetIds.length !== expected.length
    || targetIds.some((id) => !templateSet.has(id) && !extras.has(id))) {
    throw new Error('目标顺序必须恰好包含所有模板组和私有组，且组 ID 不能重复');
  }
  const orderedTemplates = targetIds.filter((id) => templateSet.has(id));
  if (orderedTemplates.some((id, i) => id !== templateIds[i])) throw new Error('不能改变模板组之间的顺序');
  if (templateIds.length && targetIds[0] !== templateIds[0]) throw new Error('私有组不能放在第一个模板组之前');

  return targetIds.flatMap((id, index) => {
    const entry = extras.get(id);
    return entry ? [{ ...entry, after: index > 0 ? targetIds[index - 1] : undefined }] : [];
  });
}
