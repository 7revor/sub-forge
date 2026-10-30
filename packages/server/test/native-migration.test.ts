import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveNativeBase } from '@sub-forge/core';
import { Store } from '../src/store.ts';
import { Cipher } from '../src/crypto.ts';

it.each([24, 27])('v%d 一次迁移原生配置、备份公共字段及平台改写，重启后不再次改写原文', version => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-native-')), file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  try {
    const preset = { id: 'p', name: '旧预设', version: 3, common: { dnsServers: ['223.5.5.5'], httpPort: 7890, socksPort: 7891, allowLan: false }, mihomo: { dns: { 'nameserver-policy': { 'geosite:cn,private': ['223.5.5.5'] } } }, surge: { host: { '*.example.test': 'server:1.1.1.1' } } };
    const ruleset = { id: 'r', name: '旧规则', sources: [{ id: 's', kind: 'local', content: 'PROCESS-NAME,Example', format: 'auto' }], overrides: [{ match: 'PROCESS-NAME,Example', override: { when: { client: 'surge', platform: 'ios' }, action: { drop: true } } }, { match: 'PROCESS-NAME,Example', override: { when: { client: 'mihomo' }, action: { drop: true } } }] };
    const profile = { id: 'sub', name: '已有订阅', nodeSets: [], base: { presetId: 'p', enabled: false } };
    for (const [kind, doc] of [['preset', preset], ['profile', profile], ['ruleset', ruleset]] as const) store.db.prepare('INSERT INTO docs (kind,id,owner,data,updated_at) VALUES (?,?,?,?,?)').run(kind, doc.id, 'owner', cipher.encrypt(JSON.stringify(doc)), 123);
    store.db.pragma(`user_version = ${version}`); store.close(); store = new Store(file, { cipher });
    const migrated = store.get('profile', 'sub')!;
    expect(store.get('preset', 'p')).toBeUndefined();
    expect(migrated.base).not.toHaveProperty('presetId');
    expect(migrated.base?.enabled).toBe(false);
    expect(parse(migrated.base!.kernels!.mihomo!).dns).toMatchObject({ nameserver: ['223.5.5.5'], 'nameserver-policy': { 'geosite:cn,private': ['223.5.5.5'] } });
    expect(migrated.base!.clients?.['surge-ios']).toContain('wifi-access-http-port = 7890');
    expect(migrated.base!.clients?.['surge-macos']).toContain('http-listen = 127.0.0.1:7890');
    expect(migrated.base!.kernels?.surge).toContain('*.example.test = server:1.1.1.1');
    expect(store.getWithOwner('profile', 'sub')).toMatchObject({ owner: 'owner', updatedAt: 123 });
    expect(store.get('ruleset', 'r')?.overrides).toHaveLength(1);
    expect((store.get('ruleset', 'r') as any).migrationNotes.join('')).toContain('已停用并备份');
    const backup = store.db.prepare("SELECT data FROM native_migration_backups WHERE kind='preset' AND id='p'").get() as { data: string };
    expect(backup.data).not.toContain('223.5.5.5'); expect(JSON.parse(cipher.decrypt(backup.data))).toEqual(preset);
    store.close(); store = new Store(file, { cipher }); expect(store.get('profile', 'sub')).toEqual(migrated);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('移除预设时保留四片段优先级、原文、停用状态和孤立备份，重复导入后可重新编辑', () => {
  const cipher = new Cipher(randomBytes(32));
  const store = new Store(':memory:', { cipher });
  try {
    const unmodified = '# 保留引号和空行\nipv6: false\n\n';
    const preset = { id: 'p', name: '已有预设', version: 1, config: {
      kernels: { mihomo: 'port: 7890\ndns:\n  enable: true\n  nameserver: [223.5.5.5]\n', surge: '[General]\nipv6 = false\n[Host]\n*.example.test = server:1.1.1.1\n', stash: unmodified },
      clients: { flclash: 'port: 7892\ndns:\n  ipv6: false\n', 'surge-macos': '[General]\ndns-server = 9.9.9.9\n' },
    } };
    const old = { id: 'sub', name: '订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' as const }, base: {
      presetId: 'p', enabled: false,
      kernels: { mihomo: 'port: 0\ndns:\n  nameserver: []\n', surge: '[General]\nipv6 = true\ndns-server = 1.1.1.1\n' },
      clients: { flclash: 'dns:\n  nameserver-policy:\n    "geosite:cn,private": 223.5.5.5\n', 'surge-macos': '[Host]\nexample.test = 192.0.2.1\n' },
    } };
    store.importSeed({ presets: [preset, { id: 'unused', name: '未使用', version: 1, config: { kernels: { mihomo: '# 未完成\ndns: [' } } }], profiles: [old] });
    const base = store.get('profile', 'sub')!.base!;
    expect(base).not.toHaveProperty('presetId'); expect(base.enabled).toBe(false);
    expect(base.kernels!.stash).toBe(unmodified);
    expect(parse(resolveNativeBase('mihomo', undefined, base))).toEqual({ port: 0, dns: { enable: true, nameserver: [] } });
    expect(parse(resolveNativeBase('mihomo', 'flclash', base))).toEqual({ port: 7892, dns: { enable: true, nameserver: [], ipv6: false, 'nameserver-policy': { 'geosite:cn,private': '223.5.5.5' } } });
    const ini = resolveNativeBase('surge', 'surge-macos', base);
    expect(ini).toContain('ipv6 = true'); expect(ini).toContain('dns-server = 9.9.9.9');
    expect(ini).toContain('*.example.test = server:1.1.1.1'); expect(ini).toContain('example.test = 192.0.2.1');
    expect(store.list('preset')).toEqual([]);
    const backup = store.db.prepare("SELECT data FROM native_migration_backups WHERE kind = 'profile' AND id = 'sub'").get() as { data: string };
    expect(JSON.parse(cipher.decrypt(backup.data))).toMatchObject(old);
    expect(store.db.prepare("SELECT id FROM native_migration_backups WHERE kind = 'preset'").all()).toHaveLength(2);
    // 重新导入已经展开的订阅保持原文不变。
    const saved = store.get('profile', 'sub')!; store.importSeed({ profiles: [saved] });
    expect(store.get('profile', 'sub')!.base).toEqual(base);
  } finally { store.close(); }
});

it('旧预设原文无效或引用已丢失时保留文本并提示，不静默抹除', () => {
  const cipher = new Cipher(randomBytes(32));
  const store = new Store(':memory:', { cipher });
  try {
    const base = { id: 'sub', name: '订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' as const } };
    store.importSeed({
      presets: [{ id: 'invalid', name: '未写完', version: 1, config: { kernels: { mihomo: 'dns: [' } } }],
      profiles: [{ ...base, base: { presetId: 'invalid', kernels: { mihomo: 'port: 0\n' } } }, { ...base, id: 'missing', base: { presetId: 'missing', kernels: { surge: '# 草稿原文\n' } } }],
    });
    const migrated = store.get('profile', 'sub')!;
    expect(migrated.base?.kernels?.mihomo).toContain('dns: [');
    expect(migrated.base?.kernels?.mihomo).toContain('port: 0\n');
    expect(migrated.migrationNotes?.join('')).toContain('无法自动合并');
    expect(() => resolveNativeBase('mihomo', undefined, migrated.base)).toThrow();
    expect(store.get('profile', 'missing')?.base).toEqual({ kernels: { surge: '# 草稿原文\n' } });
    expect(store.get('profile', 'missing')?.migrationNotes?.join('')).toContain('已不存在');
  } finally { store.close(); }
});
