import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import type { ProfileDoc } from '../src/docs.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const template = { name: '模板', groups: [{ id: 'g', name: '默认组', type: 'select' as const, members: [direct] }], rules: [], final: { kind: 'group' as const, groupId: 'g' } };

it('直接保存当前模板，不保留历史；旧草稿和无版本请求按最后保存生效，仍限制写入权限', async () => {
  const env = setupApp();
  try {
    await addUser(env.store, 'admin', 'admin'); await addUser(env.store, 'user');
    const admin = client(env.app), user = client(env.app);
    await admin.login('admin'); await user.login('user');
    const created = await admin.post('/api/templates', { ...template, changelog: '旧字段不再保存' });
    expect(created.status).toBe(201);
    const first = created.json.item;
    expect(first).not.toHaveProperty('changelog');
    expect((await user.post('/api/templates', template)).status).toBe(403);
    expect((await user.put(`/api/templates/${first.id}`, first)).status).toBe(403);
    const saved = await admin.put(`/api/templates/${first.id}`, { ...first, name: '改名后' });
    expect(saved.status).toBe(200);
    expect(saved.json.item).toMatchObject({ name: '改名后' });
    expect(saved.json.item).not.toHaveProperty('version');
    expect((await admin.put(`/api/templates/${first.id}`, { ...first, version: -1, name: '过期草稿' })).status).toBe(200);
    expect(env.store.getTemplate(first.id)?.name).toBe('过期草稿');
    expect((await admin.put(`/api/templates/${first.id}`, template)).status).toBe(200);
    expect(env.store.getTemplate(first.id)?.name).toBe('模板');
    expect(env.store.getTemplate(first.id)).not.toHaveProperty('version');
    expect(env.store.db.prepare('SELECT COUNT(*) n FROM template_versions').get()).toEqual({ n: 1 });
    expect((await admin.get(`/api/templates/${first.id}`)).json).not.toHaveProperty('versions');
    expect((await admin.get(`/api/templates/${first.id}/versions/1`)).status).toBe(404);
  } finally { env.store.close(); }
});

it('直接保存同步绑定订阅；删除仍被追加成员引用的组时拒绝保存', async () => {
  const env = setupApp();
  try {
    await addUser(env.store, 'admin', 'admin');
    const admin = client(env.app); await admin.login('admin');
    const first = (await admin.post('/api/templates', template)).json.item;
    const profile = (await admin.post('/api/profiles', { name: '绑定订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
      routing: { mode: 'bound', templateId: first.id, groupAdditions: { g: [{ kind: 'builtin', name: 'REJECT' }] } } })).json.item;
    expect(profile.id).toBeTruthy();
    const saved = await admin.put(`/api/templates/${first.id}`, { ...first, groups: [{ ...template.groups[0], name: '已同步' }] });
    expect(saved.status).toBe(200);
    const preview = await env.renderer.render(profile.id, { client: 'mihomo' });
    expect(preview.ok && preview.render.yaml).toContain('已同步');
    const blocked = await admin.put(`/api/templates/${first.id}`, { ...saved.json.item, groups: [], final: direct, force: true });
    expect(blocked.status).toBe(409);
    expect(blocked.json.details.impact[0].issues.some((issue: { code: string }) => issue.code === 'binding.orphan')).toBe(true);
    expect(env.store.getTemplate(first.id)?.groups[0]?.name).toBe('已同步');
  } finally { env.store.close(); }
});

it('v18 升级先展开旧锁定订阅，再清理历史；绑定、归属、链接及旧配置不变', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-template-current-'));
  const file = join(dir, 'state.sqlite');
  const cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher, now: () => 1234 });
  try {
    for (const version of [1, 2]) {
      const t = { ...template, id: 't', version, groups: [{ ...template.groups[0], name: `组${version}` }], changelog: '旧记录' };
      store.db.prepare('INSERT INTO template_versions VALUES (?, ?, ?, ?)').run(t.id, version, JSON.stringify(t), 1234);
    }
    const base: ProfileDoc = { id: 'pinned', name: '锁定订阅', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, template: { id: 't', follow: { pinned: 1 } } };
    store.put('profile', base, 'owner');
    const { template: _old, ...rest } = base;
    store.put('profile', { ...rest, id: 'bound', routing: { mode: 'bound', templateId: 't', groupAdditions: {} } }, 'owner');
    store.putToken({ token: 'unchanged', profileId: 'pinned' });
    store.db.pragma('user_version = 18'); store.close(); store = new Store(file, { cipher });
    expect(store.db.pragma('user_version', { simple: true })).toBe(22);
    expect(store.getWithOwner('profile', 'pinned')).toMatchObject({ owner: 'owner', updatedAt: 1234, doc: { routing: { mode: 'independent', config: { groups: [{ name: '组1' }] } } } });
    expect(store.get('profile', 'bound')?.routing).toMatchObject({ mode: 'bound', templateId: 't' });
    expect(store.getTemplate('t')).toMatchObject({ groups: [{ name: '组2' }] });
    expect(store.getTemplate('t')).not.toHaveProperty('version');
    expect(store.getTemplate('t')).not.toHaveProperty('changelog');
    expect(store.getTemplate('t', 1)).toBeUndefined();
    expect(store.getProfileMigrationBackup('pinned')).toEqual(base);
    expect(store.getToken('unchanged')?.profileId).toBe('pinned');
    expect(store.db.prepare('SELECT COUNT(*) n FROM template_versions').get()).toEqual({ n: 1 });
    store.close(); store = new Store(file, { cipher });
    expect(store.get('profile', 'pinned')?.routing?.mode).toBe('independent');
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});


it('模板检查期间有另一笔模板保存时，最后完成的保存直接覆盖', async () => {
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const env = setupApp({ fetcher: async () => { start(); await gate; return { status: 200, body: 'DOMAIN,example.com' }; } });
  try {
    await addUser(env.store, 'admin', 'admin');
    const admin = client(env.app); await admin.login('admin');
    const initial = (await admin.post('/api/templates', template)).json.item;
    const slow = admin.put(`/api/templates/${initial.id}`, { ...template, name: '最后完成', rules: [{ id: 'remote', matcher: remoteRuleMatcher('https://example.com/rules.list'), target: direct }] });
    await started;
    const fast = await admin.put(`/api/templates/${initial.id}`, { ...template, name: '先完成' });
    expect(fast.status).toBe(200);
    release();
    expect((await slow).status).toBe(200);
    expect(env.store.getTemplate(initial.id)?.name).toBe('最后完成');
    expect(env.store.getTemplate(initial.id)).not.toHaveProperty('version');
  } finally { release(); await env.snapshots.settled(); env.store.close(); }
});

it('v19 升级清除并发字段，保留绑定、内容、归属、时间与旧备份，重启幂等', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-no-concurrency-'));
  const file = join(dir, 'state.sqlite');
  const cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher, now: () => 1234 });
  try {
    const oldTemplate = { ...template, id: 't', version: 7 };
    store.db.prepare('INSERT INTO template_versions VALUES (?, ?, ?, ?)').run('t', 7, JSON.stringify(oldTemplate), 1234);
    const oldProfile = { id: 'p', name: '绑定订阅', revision: 4, templateVersion: 7, nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: 't', groupAdditions: {} } };
    const encrypted = cipher.encrypt(JSON.stringify(oldProfile));
    store.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, ?)').run('profile', 'p', 'owner', encrypted, 1234);
    store.db.prepare('INSERT INTO profile_migration_backups VALUES (?, ?, ?)').run('p', encrypted, 1234);
    store.putToken({ token: 'same-token', profileId: 'p' });
    store.putLastGood('p', 'mihomo', { yaml: '原成功内容' });
    store.db.pragma('user_version = 19'); store.close(); store = new Store(file, { cipher });
    expect(store.db.pragma('user_version', { simple: true })).toBe(22);
    expect(store.getTemplate('t')).toEqual({ ...template, id: 't' });
    const profile = store.getWithOwner('profile', 'p');
    expect(profile).toMatchObject({ owner: 'owner', updatedAt: 1234, doc: { routing: oldProfile.routing } });
    expect(profile?.doc).not.toHaveProperty('revision');
    expect(profile?.doc).not.toHaveProperty('templateVersion');
    expect(store.getProfileMigrationBackup('p')).toEqual(oldProfile);
    expect(store.getToken('same-token')?.profileId).toBe('p');
    expect(store.getLastGood('p', 'mihomo')).toEqual({ renderedAt: 1234, data: { yaml: '原成功内容' } });
    const before = [store.getTemplate('t'), profile];
    store.close(); store = new Store(file, { cipher });
    expect([store.getTemplate('t'), store.getWithOwner('profile', 'p')]).toEqual(before);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
