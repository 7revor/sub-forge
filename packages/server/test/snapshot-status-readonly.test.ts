import { describe, expect, it, vi } from 'vitest';
import { RenderService } from '../src/render.ts';
import { ResourceService } from '../src/resources.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const changes = (store: Store) => (store.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const setup = () => {
  const store = new Store(':memory:');
  const fetcher = vi.fn(async () => ({ status: 200, body: 'trojan://p@a.test:1#节点' }));
  const snapshots = new SnapshotService(store, fetcher);
  const resources = new ResourceService(store, snapshots, new RenderService(store, snapshots, { publicUrl: 'https://test.local' }));
  store.put('source', { id: 's', name: '来源', url: 'https://a.test/s', pipeline: [] }, 'u');
  return { store, fetcher, snapshots, resources };
};

describe('资源状态只读', () => {
  const source = { id: 's', url: 'https://a.test/s' };
  it('读取状态不写库', () => {
    const { store, snapshots, resources } = setup();
    try {
      const before = changes(store);
      const status = snapshots.nodeStatus(source);
      resources.statuses(resources.collect('source', 's'));
      resources.statuses(resources.all());
      expect(changes(store)).toBe(before);
      expect(status).toMatchObject({ kind: 'source', resource: 'source:s', available: false });
    } finally { store.close(); }
  });

  it('节点快照按订阅源 ID 存放，过期后仍算可用', () => {
    const { store, snapshots } = setup();
    try {
      store.addSnapshot({ ownerKind: 'source', ownerId: 's', url: source.url, fetchedAt: 100, ok: true, status: 200, body: 'old', hash: 'h' });
      expect(snapshots.nodeStatus(source)).toMatchObject({ available: true, lastSuccessAt: 100, lastAttemptAt: 100 });
      expect((store.db.prepare('SELECT owner_id FROM snapshots').get() as { owner_id: string }).owner_id).toBe('s');
    } finally { store.close(); }
  });

  it('规则状态按读取参数区分，过期内容不算可用', () => {
    const { store, snapshots } = setup();
    try {
      const url = 'https://r.test/a';
      store.addSnapshot({ ownerKind: 'ruleset', ownerId: store.ruleSnapshotKey(url), url, fetchedAt: Date.now(), ok: true, status: 200, body: 'DOMAIN,a.test', hash: 'h' });
      expect(snapshots.ruleStatus(url, { ua: '其他客户端' }).available).toBe(false);
      expect(snapshots.ruleStatus(url).available).toBe(true);
      store.db.exec('UPDATE snapshots SET fetched_at = 100');
      expect(snapshots.ruleStatus(url)).toMatchObject({ kind: 'ruleset', available: false, lastSuccessAt: undefined });
      expect(snapshots.ruleStatus(url).error).toBeUndefined();
    } finally { store.close(); }
  });
});
