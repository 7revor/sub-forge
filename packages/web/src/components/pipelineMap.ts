// 处理链预览的输入 → 输出对照：按服务端给出的来源序号（origins）把两侧节点逐个对齐，
// 改名、移除、新增与顺序调整都落在同一行上。

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

export function rowChanged(r: MapRow): boolean {
  return !r.in || !r.out || r.in.name !== r.out.name || r.moved !== 0;
}

export function mapStats(rows: MapRow[]) {
  return {
    renamed: rows.filter((r) => r.in && r.out && r.in.name !== r.out.name).length,
    removed: rows.filter((r) => !r.out).length,
    added: rows.filter((r) => !r.in).length,
    moved: rows.filter((r) => r.moved !== 0).length,
  };
}

/** 每个原始节点在第几步被移除（步骤序号 0 起）；trace 每步带完整的来源序号 */
export function removedAtStep(input: number, trace: { origins: (number | null)[] }[]): Map<number, number> {
  const at = new Map<number, number>();
  let alive = new Set(Array.from({ length: input }, (_, i) => i));
  trace.forEach((t, k) => {
    const next = new Set(t.origins.filter((o): o is number => o !== null));
    for (const o of alive) if (!next.has(o)) at.set(o, k);
    alive = next;
  });
  return at;
}

/** 每个原始节点在哪些步骤被改名（步骤序号 0 起） */
export function renamedAtSteps(input: string[], trace: { names: string[]; origins: (number | null)[] }[]): Map<number, number[]> {
  const at = new Map<number, number[]>();
  let prev = new Map(input.map((name, i) => [i, name]));
  trace.forEach((t, k) => {
    const next = new Map<number, string>();
    t.origins.forEach((o, j) => {
      if (o === null) return;
      const name = t.names[j] ?? '';
      next.set(o, name);
      if (prev.has(o) && prev.get(o) !== name) at.set(o, [...(at.get(o) ?? []), k]);
    });
    prev = next;
  });
  return at;
}
