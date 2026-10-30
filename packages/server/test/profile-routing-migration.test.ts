import { stringify as testYaml } from 'yaml';
import { issueProfileToken } from './helpers.ts';
import { profileMigrationPlan } from '../src/profile-migration-plan.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { mergeTemplate, Report, resolveProfileRouting, routingConfig, type Overlay } from '@sub-forge/core';
import { Store } from '../src/store.ts';
import { Cipher } from '../src/crypto.ts';
import type { ProfileDoc, Seed, TemplateVersionDoc } from '../src/docs.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { profileTemplate } from '../src/profile-routing.ts';

const template: TemplateVersionDoc = { id: 't', version: 1, name: '模板', groups: [
  { id: 'g', name: '香港', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] },
  { id: 'a', name: '自动', type: 'url-test', members: [{ kind: 'group', groupId: 'g' }], test: { interval: 300 } },
], rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }, target: { kind: 'group', groupId: 'g' } }], final: { kind: 'group', groupId: 'a' } };
const node = { kind: 'nodeset' as const, ref: { type: 'local' as const, id: 'local' } };
const base = (id: string, overlay: Overlay, ref: ProfileDoc['template'] = { id: 't', follow: 'latest' }): ProfileDoc => ({ id, name: id, ...(ref ? { template: ref } : {}), overlay, nodeSets: [{ ref: node.ref, output: 'provider' }], chains: [], refPolicy: { default: 'wrap' }, base: { kernels: {mihomo: testYaml({ 'mixed-port': 7890 }) } } });
const normalizedYaml = (value: string) => value.replace(/v=[a-f0-9]{32}/g, 'v=结构版本');

it('v15 旧订阅事务迁移：全量覆盖、锁定版本、空白及孤儿项均保留原始备份与有效输出，重启幂等', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-modes-'));
  const file = join(dir, 'test.sqlite');
  const cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher, now: () => 1234 });
  try {
    const historical = [template, { ...template, version: 2, groups: template.groups.map(g => ({ ...g, name: `${g.name} v2` })) }];
    for (const t of historical) store.db.prepare('INSERT INTO template_versions VALUES (?, ?, ?, ?)').run(t.id, t.version, JSON.stringify(t), 1234);
    store.put('local', { id: 'local', name: '节点', proxies: [{ name: '香港节点', type: 'socks5', server: 'node.test', port: 1080 }] }, 'owner');
    const profiles = [
      base('bound', { groupPatches: { g: { addMembers: [node] } } }),
      base('full', { groupPatches: { g: { addMembers: [node], memberOrder: 'prepend', set: { type: 'fallback', filter: '香港', test: { interval: 600 } } } }, extraGroups: [{ after: 'g', group: { id: 'private', name: '私有', type: 'select', members: [{ kind: 'group', groupId: 'g' }] } }], rulePatches: { r: { enabled: false, target: { kind: 'builtin', name: 'REJECT' } } }, extraRules: [{ anchor: 'top', rule: { id: 'private-rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'private.test' } }, target: { kind: 'group', groupId: 'private' } } }], final: { kind: 'group', groupId: 'private' } }),
      base('pinned', { groupPatches: { g: { addMembers: [node] } } }, { id: 't', follow: { pinned: 1 } }),
      { ...base('blank', { extraGroups: [{ group: { id: 'mine', name: '自己的组', type: 'select', members: [node] } }] }), template: undefined },
      base('orphan', { groupPatches: { missing: { addMembers: [node] } }, extraRules: [{ anchor: { before: 'gone' }, rule: { ...template.rules[0]!, id: 'orphan-rule' } }] }),
    ];
    profiles.forEach(p => { store.put('profile', p, 'owner'); issueProfileToken(store, { token: `${p.id}-secret-token`, profileId: p.id }); });
    const renderer = new RenderService(store, new SnapshotService(store, async () => { throw new Error('不应访问上游'); }), { publicUrl: 'https://test.local' });
    const before = new Map<string, string>();
    for (const p of profiles) {
      const r = await renderer.render(p.id, { client: 'mihomo' });
      expect(r.ok).toBe(true);
      if (r.ok) before.set(p.id, normalizedYaml(r.render.yaml));
    }
    const oldLast = store.getLastGood('full', 'mihomo:any');
    store.db.pragma('user_version = 15');
    const plan = await profileMigrationPlan(file, cipher);
    expect(plan.sourceVersion).toBe(15); expect(plan.targetVersion).toBe(25);
    expect(plan.profiles).toHaveLength(5);
    expect(store.db.pragma('user_version', { simple: true })).toBe(15);
    expect(store.get('profile', 'full')!.routing).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain('secret-token');
    store.close();
    store = new Store(file, { cipher });
    const nextRenderer = new RenderService(store, new SnapshotService(store, async () => { throw new Error('不应访问上游'); }), { publicUrl: 'https://test.local' });
    for (const old of profiles) {
      const row = store.getWithOwner('profile', old.id)!;
      expect(row.owner).toBe('owner'); expect(row.updatedAt).toBe(1234);
      expect(row.doc.routing?.mode).toBe(old.id === 'bound' ? 'bound' : 'independent');
      expect(row.doc.template).toBeUndefined();
      expect(store.getProfileMigrationBackup(old.id)).toEqual(JSON.parse(JSON.stringify(old)));
      expect(store.userToken('owner')).toBeDefined();
      const original = routingConfig(mergeTemplate(profileTemplate(old, (id, v) => historical.find(t => t.id === id && t.version === (v ?? 2))), old.overlay, new Report()));
      original.rules = original.rules.filter(rule => rule.enabled !== false).map(({ enabled: _, ...rule }) => rule);
      expect(routingConfig(resolveProfileRouting(row.doc, profileTemplate(row.doc, (id, v) => store.getTemplate(id, v)), new Report()))).toEqual(original);
      const rendered = await nextRenderer.render(old.id, { client: 'mihomo' });
      expect(rendered.ok).toBe(true);
      if (rendered.ok) expect(normalizedYaml(rendered.render.yaml)).toBe(before.get(old.id));
    }
    expect(oldLast).toBeTruthy();
    expect(store.db.prepare('SELECT data FROM profile_migration_backups').all().every((r: any) => !r.data.includes('香港'))).toBe(true);
    const full = store.get('profile', 'full');
    store.close(); store = new Store(file, { cipher });
    expect(store.get('profile', 'full')).toEqual(full);
    expect(store.db.prepare('SELECT COUNT(*) n FROM profile_migration_backups').get()).toEqual({ n: 5 });
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

it('模板版本缺失时整批回滚，数据库版本、原配置及链接保持不变', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-modes-rollback-'));
  const file = join(dir, 'test.sqlite'); const cipher = new Cipher(randomBytes(32));
  const store = new Store(file, { cipher });
  const valid = { ...base('a-valid', {}), template: undefined };
  const missing = base('z-missing', {});
  store.put('profile', valid); store.put('profile', missing); issueProfileToken(store, { token: 'keep', profileId: missing.id });
  store.db.pragma('user_version = 15'); store.close();
  try {
    expect(() => new Store(file, { cipher })).toThrow('模板版本缺失');
    const raw = new Database(file);
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(15);
      expect(JSON.parse(cipher.decrypt((raw.prepare("SELECT data FROM docs WHERE id = 'a-valid'").get() as any).data))).toEqual(JSON.parse(JSON.stringify(valid)));
      expect(raw.prepare('SELECT COUNT(*) n FROM profile_migration_backups').get()).toEqual({ n: 0 });
      expect(raw.prepare('SELECT COUNT(*) n FROM user_tokens').get()).toEqual({ n: 1 });
    } finally { raw.close(); }
  } finally { rmSync(dir, { recursive: true }); }
});

it('示例种子覆盖两种模式，原 demo 有效配置和链接保持不变', () => {
  const seed = JSON.parse(readFileSync(new URL('../examples/seed.example.json', import.meta.url), 'utf8')) as Seed;
  const store = new Store(':memory:');
  try {
    // 示例地址需要用户填写；测试使用有效的占位域名，不访问网络。
    seed.sources![0]!.url = 'https://subscription.example.test/sub';
    store.importSeed(seed, 'owner');
    const independent = store.get('profile', 'demo')!;
    const bound = store.get('profile', 'demo-bound')!;
    expect(independent.routing?.mode).toBe('independent');
    expect(bound.routing?.mode).toBe('bound');
    const template = store.getTemplate('std')!;
    const old = mergeTemplate(template, { groupPatches: { hk: { set: { filter: 'HK' }, addMembers: [{ kind: 'nodeset', ref: { type: 'local', id: 'demo-a' } }] } } }, new Report());
    expect(routingConfig(resolveProfileRouting(independent, undefined, new Report()))).toEqual(routingConfig(old));
    expect(store.getToken('demo-token')).toBeUndefined();
    expect(store.getToken('demo-bound-token')).toBeUndefined();
  } finally { store.close(); }
});
