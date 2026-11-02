import { SCHEMA_VERSION } from '../src/schema.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import type { ProfileDoc, TemplateVersionDoc } from '../src/docs.ts';
import { profileMigrationPlan } from '../src/profile-migration-plan.ts';
import { addUser, client, setupApp } from './helpers.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const template: TemplateVersionDoc = { id: 't', name: '模板', groups: [{ id: 'g', name: '选择', type: 'select', members: [direct] }], rules: [], final: { kind: 'group', groupId: 'g' } };
const legacy = (id: string): ProfileDoc => ({ id, name: id || '旧草稿', template: { id: 't', follow: 'latest' }, nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { groupPatches: { g: { addMembers: [{ kind: 'builtin', name: 'REJECT' }] } } } });

describe('订阅 routing 边界', () => {
  it('底层写入先迁移；详情、列表及分页只返回 routing，原始备份不会被后续保存覆盖', () => {
    const store = new Store(':memory:');
    try {
      store.putTemplate(template);
      const old = legacy('p');
      store.put('profile', old, 'owner');
      const current = store.get('profile', 'p')!;
      expect(current).toMatchObject({ routing: { mode: 'bound', templateId: 't', groupAdditions: { g: [{ kind: 'builtin', name: 'REJECT' }] } } });
      expect(current).not.toHaveProperty('template');
      expect(store.list('profile', 'owner')).toEqual([current]);
      expect(store.listPage('profile', { page: 1, pageSize: 20, q: '' }, 'owner').items).toEqual([current]);
      expect(store.getProfileMigrationBackup('p')).toEqual(old);
      store.put('profile', { ...current, name: '新名称' }, 'another-owner');
      expect(store.getWithOwner('profile', 'p')?.owner).toBe('owner');
      expect(store.getProfileMigrationBackup('p')).toEqual(old);
      expect(old.routing).toBeUndefined();
      const revision = store.configurationRevision;
      expect(() => store.put('profile', { ...old, template: { id: 'missing', follow: 'latest' } })).toThrow('模板版本缺失');
      expect(store.get('profile', 'p')?.name).toBe('新名称');
      expect(store.configurationRevision).toBe(revision);
    } finally { store.close(); }
  });

  it('v28 遗留文档事务迁移，保留归属、更新时间与令牌，预检只读且重启幂等', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-routing-boundary-'));
    const file = join(dir, 'test.sqlite');
    const cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher });
    const old = legacy('p');
    try {
      store.putTemplate(template);
      const user = store.createUser({ username: 'fixture', passwordHash: 'fixture-only', role: 'user' });
      store.db.prepare("INSERT INTO docs (kind,id,owner,data,updated_at) VALUES ('profile',?,?,?,?)").run(old.id, user.id, cipher.encrypt(JSON.stringify(old)), 1234);
      store.putToken({ token: 'fixture-routing-token', userId: user.id });
      store.db.pragma('user_version = 28');
      const plan = await profileMigrationPlan(file, cipher);
      expect(plan).toMatchObject({ sourceVersion: 28, targetVersion: SCHEMA_VERSION, profiles: [{ id: 'p', mode: 'bound' }] });
      expect(store.get('profile', 'p')!.routing).toBeUndefined();
      expect(store.getProfileMigrationBackup('p')).toBeUndefined();
      store.close(); store = new Store(file, { cipher });
      const migrated = store.getWithOwner('profile', 'p');
      expect(migrated).toMatchObject({ owner: user.id, updatedAt: 1234, doc: { routing: { mode: 'bound' } } });
      expect(store.getProfileMigrationBackup('p')).toEqual(old);
      expect(store.userToken(user.id)?.token).toBe('fixture-routing-token');
      store.close(); store = new Store(file, { cipher });
      expect(store.getWithOwner('profile', 'p')).toEqual(migrated);
      expect(store.db.prepare('SELECT COUNT(*) n FROM profile_migration_backups').get()).toEqual({ n: 1 });
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });

  it('旧草稿的预览、保存、转换统一校验迁移后引用，不能访问其他用户的节点', async () => {
    const env = setupApp();
    try {
      const alice = await addUser(env.store, 'alice');
      const bob = await addUser(env.store, 'bob');
      env.store.putTemplate(template);
      env.store.put('local', { id: 'foreign', name: '别人的节点', proxies: [] }, bob.id);
      const api = client(env.app); await api.login('alice');
      // 旧结构只由存储迁移和种子导入处理，接口一律拒绝，避免绕开现用引用校验。
      const old = { ...legacy(''), overlay: { groupPatches: { g: { addMembers: [{ kind: 'nodeset', ref: { type: 'local', id: 'foreign' } }] } } } };
      for (const [url, body] of [
        ['/api/profiles/preview', { profile: old }],
        ['/api/profiles', old],
        ['/api/profiles/routing/convert', { profile: old, mode: 'independent' }],
      ] as const) {
        const result = await api.post(url, body);
        expect(result.status).toBe(400); expect(result.json.error).toContain('分流方式');
      }
      const foreign = { name: '越权', nodeSets: [], routing: { mode: 'bound', templateId: template.id, groupAdditions: { g: [{ kind: 'nodeset', ref: { type: 'local', id: 'foreign' } }] } } };
      expect((await api.post('/api/profiles/preview', { profile: foreign })).status).toBe(400);
      expect(env.store.list('profile', alice.id)).toEqual([]);
    } finally { await env.snapshots.settled(); env.store.close(); }
  });
});
