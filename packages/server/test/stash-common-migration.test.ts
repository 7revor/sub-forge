import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { mergeNativeObjects, parseNativeYaml, resolveNativeBase, validateNativeBase } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import { retireStashCommon } from '../src/stash-common-migration.ts';
import { Store } from '../src/store.ts';

const profile = (base: Record<string, unknown>) => ({ id: 'sub', name: '历史配置', nodeSets: [], chains: [], routing: { mode: 'independent' as const, config: { groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } } }, base });

it('按字段去重，删除重复层后已有客户端原文逐字保留，Mihomo 的后续修改即时继承', () => {
  const own = '# 客户端草稿\nmode: "rule"\n\n';
  const original = profile({ kernels: { mihomo: 'dns:\n  enable: true\n  nameserver: [223.5.5.5]\n', stash: '# 排版不同但内容相同\ndns: {nameserver: [223.5.5.5], enable: true}\n' }, clients: { 'stash-ios': own } });
  const snapshot = structuredClone(original), next = retireStashCommon(original);
  expect(original).toEqual(snapshot);
  expect(next.base.kernels).not.toHaveProperty('stash');
  expect(next.base.clients).toEqual({ 'stash-ios': own });
  validateNativeBase(next.base);
  next.base.kernels!.mihomo = 'dns: {enable: false, nameserver: [1.1.1.1]}';
  for (const app of ['stash-ios', 'stash-macos'] as const) expect(parse(resolveNativeBase('stash', app, next.base)).dns).toEqual({ enable: false, nameserver: ['1.1.1.1'] });
  expect(retireStashCommon(next)).toBe(next);
});

it('保留嵌套差异、false、0、null、空列表、空映射和列表整体覆盖，已有应用追加优先', () => {
  const common = { dns: { enable: true, ipv6: true, nameserver: ['223.5.5.5'], policy: { cn: 'a', private: 'b' } }, port: 7890, hosts: ['旧值'], tun: { enable: true }, sniffer: false };
  const old = { dns: { enable: true, ipv6: false, nameserver: [], policy: { cn: 'a', other: 'c' } }, port: 0, hosts: null, tun: {}, sniffer: {} };
  const own = { dns: { nameserver: ['9.9.9.9'] }, port: 12 };
  const next = retireStashCommon(profile({ enabled: false, kernels: { mihomo: stringify(common), stash: stringify(old) }, clients: { 'stash-ios': stringify(own), 'surge-ios': '# 其他客户端\n' } }));
  expect(next.base.enabled).toBe(false);
  expect(next.base.clients['surge-ios']).toBe('# 其他客户端\n');
  expect(parse(next.base.clients['stash-macos'])).toEqual({ dns: { ipv6: false, nameserver: [], policy: { other: 'c' } }, port: 0, hosts: null, sniffer: {} });
  expect(parse(resolveNativeBase('stash', 'stash-ios', next.base))).toEqual(mergeNativeObjects(mergeNativeObjects(common, old), own));
  expect(parse(resolveNativeBase('stash', 'stash-macos', next.base))).toEqual(mergeNativeObjects(common, old));
  next.base.kernels.mihomo = stringify({ ...common, dns: { ...common.dns, enable: false, policy: { cn: '新值', private: 'b' } } });
  expect(parse(resolveNativeBase('stash', 'stash-macos', next.base)).dns).toMatchObject({ enable: false, ipv6: false, policy: { cn: '新值', other: 'c' } });
});

it.each(['', ' \n', '# 只有注释\n'])('空白或纯注释旧层直接退役，客户端草稿不变：%j', stash => {
  const next = retireStashCommon(profile({ kernels: { stash }, clients: { 'stash-ios': 'dns: [' } }));
  expect(next.base.kernels).toEqual({});
  expect(next.base.clients).toEqual({ 'stash-ios': 'dns: [' });
});

it.each([
  { mihomo: 'dns: [', stash: 'ipv6: false\n', own: 'mode: rule\n' },
  { mihomo: 'ipv6: true\n', stash: '# 未完成\ndns: [', own: 'mode: rule\n' },
  { mihomo: 'ipv6: true\n', stash: 'ipv6: false\n', own: '# 未完成\ndns: [' },
])('无效草稿保留原文并展示诊断，不阻止迁移：%j', ({ mihomo, stash, own }) => {
  const next = retireStashCommon(profile({ kernels: { mihomo, stash }, clients: { 'stash-ios': own } }));
  expect(next.base.kernels).toEqual({ mihomo });
  expect(next.base.clients['stash-macos']).toBe(stash);
  expect(next.migrationNotes.join('')).toContain('请修复后预览');
  expect(() => resolveNativeBase('stash', 'stash-ios', next.base)).toThrow();
  if (stash.includes('dns: [') || own.includes('dns: [')) {
    expect(next.base.clients['stash-ios']).toContain(stash);
    expect(next.base.clients['stash-ios']).toContain(own);
  }
});

it('不能等价折叠的类型覆盖保留两份原文并要求修复，避免无声改变结果', () => {
  const next = retireStashCommon(profile({ kernels: { mihomo: 'dns: {enable: true}\n', stash: 'dns: null\n' }, clients: { 'stash-ios': 'dns: {ipv6: false}\n' } }));
  expect(next.base.clients['stash-ios']).toContain('dns: null');
  expect(next.base.clients['stash-ios']).toContain('dns: {ipv6: false}');
  expect(next.migrationNotes.join('')).toContain('无法保持原结果自动折叠');
  expect(() => parseNativeYaml(next.base.clients['stash-ios'])).toThrow();
  expect(parse(resolveNativeBase('stash', 'stash-macos', next.base))).toEqual({ dns: null });
});

it.each([28, 30, 32, 33])('v%d 升级和旧种子导入执行相同迁移，加密备份、归属、时间与重启幂等，产物表保持退役', version => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-stash-common-')), file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  try {
    const original = profile({ enabled: false, kernels: { mihomo: 'dns: {enable: true}\n', stash: 'dns: {enable: true, ipv6: false}\n' }, clients: { 'stash-ios': '# 保留应用优先级\nmode: rule\n' } });
    store.db.prepare('INSERT INTO docs (kind,id,owner,data,updated_at) VALUES (?,?,?,?,?)').run('profile', original.id, 'owner', cipher.encrypt(JSON.stringify(original)), 123);
    store.db.prepare('INSERT INTO native_migration_backups VALUES (?,?,?,?)').run('profile', original.id, cipher.encrypt('{"older":true}'), 1);
    if (version < 33) {
      store.db.exec('CREATE TABLE last_good (profile_id TEXT NOT NULL, target TEXT NOT NULL, rendered_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (profile_id, target))');
      store.db.prepare('INSERT INTO last_good VALUES (?,?,?,?)').run('sub', 'stash:ios:stash-ios', 1, cipher.encrypt('{"yaml":"旧结果"}'));
    }
    store.db.pragma(`user_version = ${version}`); store.close(); store = new Store(file, { cipher });
    const saved = store.get('profile', 'sub')!;
    expect(store.db.pragma('user_version', { simple: true })).toBe(34);
    expect(saved.base?.kernels).not.toHaveProperty('stash');
    expect(parse(saved.base!.clients!['stash-ios']!)).toEqual({ dns: { ipv6: false }, mode: 'rule' });
    expect(saved.base!.clients!['stash-macos']).toBe('dns:\n  ipv6: false\n');
    expect(store.getWithOwner('profile', 'sub')).toMatchObject({ owner: 'owner', updatedAt: 123 });
    const backup = store.db.prepare("SELECT data FROM native_migration_backups WHERE kind = 'profile-stash-common-v34' AND id = 'sub'").get() as { data: string };
    expect(backup.data).not.toContain('ipv6');
    expect(JSON.parse(cipher.decrypt(backup.data))).toMatchObject(original);
    const older = store.db.prepare("SELECT data FROM native_migration_backups WHERE kind = 'profile' AND id = 'sub'").get() as { data: string };
    expect(JSON.parse(cipher.decrypt(older.data))).toEqual({ older: true });
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('last_good', 'shared_rule_resources')").all()).toEqual([]);
    store.close(); store = new Store(file, { cipher });
    expect(store.get('profile', 'sub')).toEqual(saved);
    store.importSeed({ profiles: [saved] });
    expect(store.get('profile', 'sub')!.base).toEqual(saved.base);
    store.importSeed({ profiles: [{ ...original, id: 'imported' }] }, 'import-owner');
    expect(store.get('profile', 'imported')!.base).toEqual(saved.base);
    expect(store.getWithOwner('profile', 'imported')?.owner).toBe('import-owner');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('损坏的旧值会回滚整个种子事务，原文档和备份不被部分修改', () => {
  const store = new Store(':memory:');
  try {
    expect(() => store.importSeed({ profiles: [profile({ kernels: { mihomo: 'ipv6: true', stash: 'ipv6: false' } }), { ...profile({ kernels: { stash: [] } }), id: 'bad' }] } as any)).toThrow('旧 Stash 公共配置必须是原始文本');
    expect(store.list('profile')).toEqual([]);
    expect(store.db.prepare("SELECT id FROM native_migration_backups WHERE kind = 'profile-stash-common-v34'").all()).toEqual([]);
  } finally { store.close(); }
});
