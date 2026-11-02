import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const profile = { id: 'p', name: '旧字段', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' as const }, revision: 7, templateVersion: 3,
  routing: { mode: 'independent' as const, config: { groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } } } };
const retired = ['overlay', 'refPolicy', 'template', 'revision', 'templateVersion', 'updateIntervalSec'];
const schema = (store: Store) => store.db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

describe('退役存储结构清理', () => {
  it.each([23, 28, 29])('v%s 升级结果与新库相同，原始备份及业务身份保持不变', version => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-retired-storage-'));
    const file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher });
    const fresh = new Store(':memory:');
    try {
      const expectedSchema = schema(fresh);
      store.db.exec('CREATE TABLE sub_tokens (token_hash TEXT PRIMARY KEY, token_enc TEXT, profile_id TEXT, label TEXT, created_at INTEGER)');
      store.db.prepare("INSERT INTO docs (kind,id,owner,data,updated_at) VALUES ('profile','p','owner',?,1234)").run(cipher.encrypt(JSON.stringify(profile)));
      const source = { id: 's', name: '来源', kind: 'remote', url: 'https://fixture.test/nodes', pipeline: [] };
      store.db.prepare("INSERT INTO docs (kind,id,owner,data,updated_at) VALUES ('source','s','owner',?,1234)").run(cipher.encrypt(JSON.stringify(source)));
      store.db.pragma(`user_version = ${version}`);
      store.close(); store = new Store(file, { cipher });
      expect(schema(store)).toEqual(expectedSchema);
      expect(store.getWithOwner('profile', 'p')).toMatchObject({ owner: 'owner', updatedAt: 1234 });
      const current = store.get('profile', 'p')!;
      for (const key of retired) expect(current).not.toHaveProperty(key);
      expect(current.routing).toEqual(profile.routing);
      expect(store.getProfileMigrationBackup('p')).toEqual(profile);
      expect(store.getWithOwner('source', 's')).toMatchObject({ owner: 'owner', updatedAt: 1234 });
      expect(store.get('source', 's')).not.toHaveProperty('kind');
      store.close(); store = new Store(file, { cipher });
      expect(schema(store)).toEqual(expectedSchema);
      expect(store.getProfileMigrationBackup('p')).toEqual(profile);
    } finally { store.close(); fresh.close(); rmSync(dir, { recursive: true }); }
  });

  it('API 与底层保存都不再写回退役字段，已存原始备份不会覆盖', async () => {
    const env = setupApp();
    try {
      const user = await addUser(env.store, 'owner');
      const api = client(env.app); await api.login('owner');
      const result = await api.post('/api/profiles', profile);
      expect(result.status).toBe(201);
      for (const key of retired) expect(result.json.item).not.toHaveProperty(key);
      expect(env.store.get('profile', result.json.item.id)).toEqual(result.json.item);
      env.store.put('profile', profile, user.id);
      for (const key of retired) expect(env.store.get('profile', 'p')).not.toHaveProperty(key);
      const source = { id: 's', name: '来源', kind: 'remote', url: 'https://fixture.test/nodes', pipeline: [] };
      env.store.put('source', source, user.id);
      expect(env.store.get('source', 's')).not.toHaveProperty('kind');
      expect(source.kind).toBe('remote');
      expect(profile.overlay).toEqual({});
    } finally { await env.snapshots.settled(); env.store.close(); }
  });
});
