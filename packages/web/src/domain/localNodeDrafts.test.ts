import { describe, expect, it } from 'vitest';
import { movedIndex, moveNodeTexts, removeNodeText } from './localNodeDrafts.ts';

describe('本地节点草稿下标', () => {
  it('向后和向前移动时，只影响区间内的节点', () => {
    expect([0, 1, 2, 3].map(i => movedIndex(i, 0, 2))).toEqual([2, 0, 1, 3]);
    expect([0, 1, 2, 3].map(i => movedIndex(i, 3, 1))).toEqual([0, 2, 3, 1]);
  });

  it('移动节点时草稿跟随节点，新增草稿不受影响', () => {
    expect(moveNodeTexts({ 0: 'a', 2: 'c', new: 'n' }, 0, 2)).toEqual({ 2: 'a', 1: 'c', new: 'n' });
  });

  it('删除节点时丢弃它的草稿，后面的下标前移', () => {
    expect(removeNodeText({ 0: 'a', 1: 'b', 3: 'd', new: 'n' }, 1)).toEqual({ 0: 'a', 2: 'd', new: 'n' });
  });
});
