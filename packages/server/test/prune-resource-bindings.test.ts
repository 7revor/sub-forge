import { describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.ts';

describe('绑定清理不解密无关文档', () => {
  it('跳过本地节点组与组合，保留仍被规则集引用的绑定', () => {
    const store = new Store(':memory:');
    try {
      store.put('local', { id: 'l', name: '本地', proxies: [] }, 'u');
      store.put('collection', { id: 'c', name: '组合', members: [], pipeline: [] }, 'u');
      store.put('ruleset', { id: 'r', name: '规则', sources: [{ id: 'a', kind: 'remote', url: 'https://r.test/a', format: 'auto' }] }, 'u');
      store.bindResource('ruleset', 'r', 'https://r.test/a', {}, 'public-rules');
      const raw = new Set((store.db.prepare("SELECT data FROM docs WHERE kind IN ('local','collection')").all() as { data: string }[]).map(row => row.data));
      const parse = vi.spyOn(JSON, 'parse');
      store.pruneResourceBindings();
      expect(parse.mock.calls.filter(([value]) => raw.has(value))).toEqual([]);
      expect(store.resourceBinding('ruleset', 'r', 'https://r.test/a')).toBeDefined();
    } finally { store.close(); }
  });
});
