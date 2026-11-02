import { SCHEMA_VERSION } from '../src/schema.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { RenderService } from '../src/render.ts';
import { ResourceService } from '../src/resources.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const jobs = (store: Store) => (store.db.prepare('SELECT id FROM refresh_jobs ORDER BY id').all() as { id: string }[]).map(row => row.id);
const putJob = (store: Store, id: string, kind: string, documentId: string) => store.db.prepare('INSERT INTO refresh_jobs VALUES (?,?,?,?)')
  .run(id, 'owner', store.cipher.encrypt(JSON.stringify({ id, owner: 'owner', kind, documentId, state: 'done', total: 0, completed: 0, results: [] })), 1);
const service = (store: Store) => {
  const snapshots = new SnapshotService(store, vi.fn());
  return new ResourceService(store, snapshots, new RenderService(store, snapshots, { publicUrl: 'https://test.local' }));
};

describe('刷新任务存储', () => {
  it('结构由 Store 建立；v31 库升级补表且保留已有任务，重启幂等', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-refresh-jobs-'));
    const file = join(dir, 'db.sqlite'), cipher = new Cipher(randomBytes(32));
    try {
      let store = new Store(file, { cipher });
      expect(jobs(store)).toEqual([]);
      store.db.exec('DROP TABLE refresh_jobs; PRAGMA user_version = 31');
      store.close(); store = new Store(file, { cipher });
      expect(store.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      putJob(store, 'kept', 'profile', 'p');
      store.db.pragma('user_version = 31');
      store.close(); store = new Store(file, { cipher });
      expect(jobs(store)).toEqual(['kept']);
      store.close(); store = new Store(file, { cipher });
      expect(jobs(store)).toEqual(['kept']);
      store.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('只清理被删文档的任务，并随删除事务回滚', async () => {
    const store = new Store(':memory:');
    try {
      const resources = service(store);
      store.put('source', { id: 's', name: '来源', url: 'https://a.test', pipeline: [] });
      putJob(store, 'match', 'source', 's');
      putJob(store, 'other-document', 'source', 'other');
      putJob(store, 'other-kind', 'system-resource', 's');
      expect(() => store.db.transaction(() => { store.delete('source', 's'); throw new Error('外层回滚'); })()).toThrow('外层回滚');
      expect(store.get('source', 's')).toBeDefined();
      expect(jobs(store)).toEqual(['match', 'other-document', 'other-kind']);
      store.delete('source', 's');
      expect(jobs(store)).toEqual(['other-document', 'other-kind']);
      await resources.stop();
      expect(store.documentDeleteHooks.size).toBe(0);
    } finally { store.close(); }
  });
});
