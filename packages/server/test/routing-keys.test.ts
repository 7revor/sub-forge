import { SCHEMA_VERSION } from '../src/schema.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const reject = { kind: 'builtin' as const, name: 'REJECT' as const };
const template = (id: string) => ({ name: '特殊 ID 模板', groups: [{ id, name: '策略组', type: 'select' as const, members: [direct], display: { hidden: true } }], rules: [], final: direct });

it.each(['constructor', 'toString', '__proto__'])('特殊组 ID %s 支持创建、保存、预览和模板转换', async id => {
  const env = setupApp();
  try {
    await addUser(env.store, 'admin', 'admin');
    const api = client(env.app); await api.login('admin');
    const createdTemplate = await api.post('/api/templates', template(id));
    expect(createdTemplate.status).toBe(201);
    const templateId = createdTemplate.json.item.id;
    const created = await api.post('/api/profiles', { name: '特殊 ID 订阅', nodeSets: [], chains: [], routing: { mode: 'bound', templateId, groupAdditions: {} } });
    expect(created.status).toBe(201);
    const preview = await api.post('/api/profiles/preview', { profile: created.json.item });
    expect(preview.status).toBe(200); expect(preview.json.ok).toBe(true);
    expect(parse(preview.json.yaml)['proxy-groups'][0].hidden).toBe(true);
    const saved = await api.put(`/api/profiles/${created.json.item.id}`, { ...created.json.item, routing: { ...created.json.item.routing, groupAdditions: { [id]: [reject] }, groupHidden: { [id]: false } } });
    expect(saved.status).toBe(200);
    const target = await api.post('/api/templates', template(id));
    const converted = await api.post('/api/profiles/routing/convert', { profile: saved.json.item, mode: 'bound', templateId: target.json.item.id, mapping: { [id]: id } });
    expect(converted.status).toBe(200);
    expect(Object.hasOwn(converted.json.item.routing.groupHidden, id)).toBe(true);
    expect(converted.json.item.routing.groupHidden[id]).toBe(false);
    expect(converted.json.item.routing.groupAdditions[id]).toEqual([reject]);
    const detached = await api.post('/api/profiles/routing/convert', { profile: converted.json.item, mode: 'independent' });
    expect(detached.status).toBe(200);
    expect(detached.json.item.routing.config.groups[0]).toMatchObject({ id, members: [direct, reject], display: { hidden: false } });
  } finally { await env.snapshots.settled(); env.store.close(); }
});

it.each(['constructor', 'toString', '__proto__'])('v15 的特殊组 ID %s 可升级并保留原始备份', id => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-routing-keys-'));
  const file = join(dir, 'test.sqlite'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  const old = { id: 'p', name: '旧订阅', nodeSets: [], chains: [], overlay: {}, template: { id: 't', follow: 'latest' } };
  try {
    store.db.exec('DROP TABLE templates; CREATE TABLE template_versions (template_id TEXT, version INTEGER, data TEXT, created_at INTEGER, PRIMARY KEY(template_id,version)); PRAGMA user_version=15');
    store.db.prepare('INSERT INTO template_versions VALUES (?,?,?,?)').run('t', 1, JSON.stringify({ ...template(id), id: 't', version: 1 }), 123);
    store.db.prepare('INSERT INTO docs VALUES (?,?,?,?,?)').run('profile', 'p', 'owner', cipher.encrypt(JSON.stringify(old)), 123);
    store.close(); store = new Store(file, { cipher });
    expect(store.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(store.getWithOwner('profile', 'p')).toMatchObject({ owner: 'owner', updatedAt: 123, doc: { routing: { mode: 'bound', groupAdditions: {} } } });
    expect(store.getProfileMigrationBackup('p')).toEqual(old);
    store.close(); store = new Store(file, { cipher });
    expect(store.getProfileMigrationBackup('p')).toEqual(old);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
