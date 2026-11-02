import { describe, expect, it, vi } from 'vitest';
import { RenderService } from '../src/render.ts';
import { ResourceService } from '../src/resources.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const changes = (store: Store) => (store.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const bindings = (store: Store) => store.db.prepare('SELECT * FROM resource_bindings').all();
const setup = () => {
  const store = new Store(':memory:');
  const fetcher = vi.fn(async () => ({ status: 200, body: 'trojan://p@a.test:1#节点' }));
  const snapshots = new SnapshotService(store, fetcher);
  const resources = new ResourceService(store, snapshots, new RenderService(store, snapshots, { publicUrl: 'https://test.local' }));
  store.put('source', { id: 's', name: '来源', url: 'https://a.test/s', pipeline: [] }, 'u');
  return { store, fetcher, snapshots, resources };
};

describe('资源状态只读', () => {
  it('读取状态不写库；资源标识与之后的绑定一致', () => {
    const { store, snapshots, resources } = setup();
    try {
      const before = changes(store);
      const status = snapshots.status('source', 's', 'https://a.test/s');
      resources.statuses(resources.collect('source', 's'));
      resources.statuses(resources.all());
      expect(changes(store)).toBe(before);
      expect(bindings(store)).toEqual([]);
      expect(status).toMatchObject({ available: false, nextFetchAt: undefined });
      expect(snapshots.identity('source', 's', 'https://a.test/s')).toBe(status.resource);
    } finally { store.close(); }
  });

  it('未绑定的旧快照可见但不被迁移，绑定后状态不变', () => {
    const { store, snapshots } = setup();
    try {
      store.addSnapshot({ ownerKind: 'source', ownerId: 's', url: 'https://a.test/s', fetchedAt: 100, ok: true, status: 200, body: 'old', hash: 'h' });
      const before = changes(store);
      const status = snapshots.status('source', 's', 'https://a.test/s');
      expect(changes(store)).toBe(before);
      expect(status).toMatchObject({ available: true, lastSuccessAt: 100, lastAttemptAt: 100 });
      expect((store.db.prepare('SELECT owner_id FROM snapshots').get() as { owner_id: string }).owner_id).toBe('s');
      expect(snapshots.identity('source', 's', 'https://a.test/s')).toBe(status.resource);
      expect(snapshots.status('source', 's', 'https://a.test/s')).toEqual(status);
      expect((store.db.prepare('SELECT owner_id FROM snapshots').get() as { owner_id: string }).owner_id).toBe(status.resource);
    } finally { store.close(); }
  });

  it('参数不兼容的草稿读取不能看到旧快照正文的状态', () => {
    const { store, snapshots } = setup();
    try {
      store.put('ruleset', { id: 'r', name: '规则', sources: [{ id: 'a', kind: 'remote', url: 'https://r.test/a', format: 'auto' }] }, 'u');
      store.addSnapshot({ ownerKind: 'ruleset', ownerId: 'r', url: 'https://r.test/a', fetchedAt: 100, ok: true, status: 200, body: 'DOMAIN,a.test', hash: 'h' });
      expect(snapshots.status('ruleset', 'r', 'https://r.test/a', { ua: '其他客户端' }).available).toBe(false);
      expect(snapshots.status('ruleset', 'r', 'https://r.test/a').available).toBe(true);
    } finally { store.close(); }
  });

});
