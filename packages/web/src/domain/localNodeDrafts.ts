// 本地节点原文草稿按节点下标保存；节点移动或删除时，草稿要跟着节点走。

export type NodeTexts = Record<string, string>;

/** 单个节点从 from 移到 to 后，原下标 index 的新位置。 */
export function movedIndex(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < index && index <= to) return index - 1;
  if (to <= index && index < from) return index + 1;
  return index;
}

const remap = (texts: NodeTexts, next: (index: number) => number | undefined): NodeTexts => {
  const result: NodeTexts = {};
  for (const [key, text] of Object.entries(texts)) {
    if (key === 'new') { result.new = text; continue; }
    const index = next(Number(key));
    if (index !== undefined) result[index] = text;
  }
  return result;
};

export const moveNodeTexts = (texts: NodeTexts, from: number, to: number) => remap(texts, index => movedIndex(index, from, to));

export const removeNodeText = (texts: NodeTexts, removed: number) => remap(texts, index => index === removed ? undefined : index > removed ? index - 1 : index);
