import { issueProfileToken } from './helpers.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

describe('移除 GitHub 凭据', () => {
  it('管理员也不能读取、保存或删除旧配置接口', async () => {
    const { store, app } = setupApp();
    try {
      await addUser(store, 'admin', 'admin');
      const admin = client(app); await admin.login('admin');
      expect((await admin.get('/api/rule-repos/github-token')).status).toBe(404);
      expect((await admin.put('/api/rule-repos/github-token', { token: 'obsolete-test-token' })).status).toBe(404);
      expect((await admin.del('/api/rule-repos/github-token')).status).toBe(404);
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'server_secrets'").get()).toBeUndefined();
    } finally { store.close(); }
  });

  it.each([11, 12, 13, 14])('从 v%s 升级清理旧凭据，保留业务文档和订阅令牌，重启幂等', version => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-token-removal-'));
    const path = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
    let store = new Store(path, { cipher });
    try {
      store.put('source', { id: 's1', name: '保留的来源', url: 'https://example.test/sub', pipeline: [] }, 'alice');
      issueProfileToken(store, { token: 'subscription-token', profileId: 'profile-1' });
      if (version >= 12) {
        store.db.exec('CREATE TABLE server_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
        store.db.prepare('INSERT INTO server_secrets VALUES (?, ?)').run('github-index-token', cipher.encrypt('obsolete-test-token'));
      }
      store.db.pragma(`user_version = ${version}`);
      store.close(); store = new Store(path, { cipher });
      for (let i = 0; i < 2; i++) {
        expect(store.db.pragma('user_version', { simple: true })).toBe(24);
        expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'server_secrets'").get()).toBeUndefined();
        expect(store.getWithOwner('source', 's1')).toMatchObject({ owner: 'alice', doc: { name: '保留的来源' } });
        expect(store.getToken('subscription-token')?.token).toBe('subscription-token');
        store.close(); store = new Store(path, { cipher });
      }
    } finally {
      store.close();
      for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
      rmdirSync(dir);
    }
  });

  it('迁移只清理 GitHub 凭据，不删除未知服务凭据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-other-secrets-'));
    const path = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
    let store = new Store(path, { cipher });
    try {
      store.db.exec("CREATE TABLE server_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO server_secrets VALUES ('github-index-token', 'old'), ('other-service', 'keep'); PRAGMA user_version = 13");
      store.close(); store = new Store(path, { cipher });
      expect(store.db.prepare('SELECT * FROM server_secrets').all()).toEqual([{ name: 'other-service', value: 'keep' }]);
    } finally {
      store.close();
      for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
      rmdirSync(dir);
    }
  });
});
