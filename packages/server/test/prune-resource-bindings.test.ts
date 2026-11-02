import { describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.ts';

describe('绑定清理不解密无关文档', () => {
  it('跳过本地节点组与组合，失效共享规则仍被删除并通知', () => {
    const store = new Store(':memory:');
    try {
      store.put('local', { id: 'l', name: '本地', proxies: [] }, 'u');
      store.put('collection', { id: 'c', name: '组合', members: [], pipeline: [] }, 'u');
      store.put('ruleset', { id: 'r', name: '规则', sources: [{ id: 'a', kind: 'remote', url: 'https://r.test/a', format: 'auto' }] }, 'u');
      store.putSharedRule('live', 'r', { reference: { matcher: { kind: 'ruleset', id: 'r' } } });
      store.putSharedRule('dead', 'gone', { reference: { matcher: { kind: 'ruleset', id: 'gone' } } });
      store.bindResource('ruleset', 'r', 'https://r.test/a', {}, 'public-rules');
      const raw = new Set((store.db.prepare("SELECT data FROM docs WHERE kind IN ('local','collection')").all() as { data: string }[]).map(row => row.data));
      const decrypt = vi.spyOn(store.cipher, 'decrypt');
      const notified: string[] = [];
      store.invalidationListeners.add((kind, id) => { notified.push(`${kind}:${id}`); });
      store.pruneResourceBindings();
      expect(decrypt.mock.calls.filter(([value]) => raw.has(value))).toEqual([]);
      expect(notified).toEqual(['shared-rule:dead']);
      expect(store.getSharedRule('dead')).toBeUndefined();
      expect(store.getSharedRule('live')).toBeDefined();
      expect(store.resourceBinding('ruleset', 'r', 'https://r.test/a')).toBeDefined();
    } finally { store.close(); }
  });
});
