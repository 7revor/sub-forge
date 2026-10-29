import { describe, expect, it } from 'vitest';
import { mapRows, mapStats, removedAtStep, renamedAtSteps, rowChanged } from './pipelineMap.ts';

describe('处理链输入 → 输出对照', () => {
  const before = { names: ['日本 03', '官网', '香港 01'], origins: [0, 1, 2] };
  const after = { names: ['HK-01', 'JP-03', '脚本新增'], origins: [2, 0, null] };

  it('按输出顺序：保留的在前，新增其次，移除的排在最后', () => {
    const rows = mapRows(before, after);
    expect(rows.map((r) => [r.in?.name, r.out?.name, r.moved])).toEqual([
      ['香港 01', 'HK-01', 1],
      ['日本 03', 'JP-03', -1],
      [undefined, '脚本新增', 0],
      ['官网', undefined, 0],
    ]);
    expect(mapStats(rows)).toEqual({ renamed: 2, removed: 1, added: 1, moved: 2 });
  });

  it('按输入顺序：移除的留在原位，新增排在最后', () => {
    expect(mapRows(before, after, 'in').map((r) => r.in?.index ?? `+${r.out?.index}`)).toEqual([0, 1, 2, '+2']);
  });

  it('移除节点造成的前移不算顺序调整', () => {
    const rows = mapRows(before, { names: ['日本 03', '香港 01'], origins: [0, 2] });
    expect(rows.filter(rowChanged).map((r) => r.in?.name)).toEqual(['官网']);
  });

  it('记录每个原始节点在哪一步被移除', () => {
    expect([...removedAtStep(4, [{ origins: [0, 2, 3] }, { origins: [3, 0] }, { origins: [3, 0] }])]).toEqual([[1, 0], [2, 1]]);
  });

  it('记录每个原始节点在哪些步骤被改名', () => {
    const trace = [{ names: ['JP', 'b'], origins: [0, 1] }, { names: ['b2', 'JP'], origins: [1, 0] }, { names: ['🇯🇵 JP', 'b2'], origins: [0, 1] }];
    expect([...renamedAtSteps(['a', 'b'], trace)]).toEqual([[0, [0, 2]], [1, [1]]]);
  });
});
