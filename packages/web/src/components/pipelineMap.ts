// 处理链总览统计：按服务端来源序号（origins）匹配输入与输出，
// 计算改名、移除、新增与顺序调整；页面仍分别展示两侧列表。

/** 对照表的一行；in 缺省为脚本新增，out 缺省为被移除 */
export type MapRow = {
  in?: { index: number; name: string };
  out?: { index: number; name: string };
  /** 来源序号（第几个原始节点），新增节点为 null */
  origin: number | null;
  /** 在保留下来的节点中名次的变化：正数 = 上移几位 */
  moved: number;
};

type Side = { names: string[]; origins: (number | null)[] };

export function mapRows(before: Side, after: Side, order: 'out' | 'in' = 'out'): MapRow[] {
  const pos = new Map<number, number>();
  before.origins.forEach((o, i) => { if (o !== null) pos.set(o, i); });
  const matched = new Set<number>();
  const kept: MapRow[] = [];
  const added: MapRow[] = [];
  after.origins.forEach((o, j) => {
    const i = o === null ? undefined : pos.get(o);
    const out = { index: j, name: after.names[j] ?? '' };
    if (i === undefined) { added.push({ out, origin: o, moved: 0 }); return; }
    matched.add(i);
    kept.push({ in: { index: i, name: before.names[i] ?? '' }, out, origin: o, moved: 0 });
  });
  // 名次只在保留下来的节点之间比较，移除节点造成的整体前移不算顺序调整
  const outRank = new Map(kept.map((r, j) => [r, j]));
  [...kept].sort((a, b) => a.in!.index - b.in!.index).forEach((r, rank) => { r.moved = rank - outRank.get(r)!; });
  const removed: MapRow[] = before.names.flatMap((name, i) => (matched.has(i) ? [] : [{ in: { index: i, name }, origin: before.origins[i] ?? null, moved: 0 }]));
  if (order === 'out') return [...kept, ...added, ...removed];
  return [...[...kept, ...removed].sort((a, b) => a.in!.index - b.in!.index), ...added];
}

export function mapStats(rows: MapRow[]) {
  return {
    renamed: rows.filter((r) => r.in && r.out && r.in.name !== r.out.name).length,
    removed: rows.filter((r) => !r.out).length,
    added: rows.filter((r) => !r.in).length,
    moved: rows.filter((r) => r.moved !== 0).length,
  };
}
