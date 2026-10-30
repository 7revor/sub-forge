import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { Store } from '../src/store.ts';
import { Cipher } from '../src/crypto.ts';

it('v24 一次迁移原生配置、备份公共字段及平台改写，重启后不再次改写原文', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-native-')), file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  try {
    const preset = { id: 'p', name: '旧预设', version: 3, common: { dnsServers: ['223.5.5.5'], httpPort: 7890, socksPort: 7891, allowLan: false }, mihomo: { dns: { 'nameserver-policy': { 'geosite:cn,private': ['223.5.5.5'] } } }, surge: { host: { '*.example.test': 'server:1.1.1.1' } } };
    const ruleset = { id: 'r', name: '旧规则', sources: [{ id: 's', kind: 'local', content: 'PROCESS-NAME,Example', format: 'auto' }], overrides: [{ match: 'PROCESS-NAME,Example', override: { when: { client: 'surge', platform: 'ios' }, action: { drop: true } } }, { match: 'PROCESS-NAME,Example', override: { when: { client: 'mihomo' }, action: { drop: true } } }] };
    for (const [kind, doc] of [['preset', preset], ['ruleset', ruleset]] as const) store.db.prepare('INSERT INTO docs (kind,id,owner,data,updated_at) VALUES (?,?,?,?,?)').run(kind, doc.id, 'owner', cipher.encrypt(JSON.stringify(doc)), 123);
    store.db.pragma('user_version = 24'); store.close(); store = new Store(file, { cipher });
    const migrated = store.get('preset', 'p')!;
    expect(parse(migrated.config.kernels!.mihomo!).dns).toMatchObject({ nameserver: ['223.5.5.5'], 'nameserver-policy': { 'geosite:cn,private': ['223.5.5.5'] } });
    expect(migrated.config.clients?.['surge-ios']).toContain('wifi-access-http-port = 7890');
    expect(migrated.config.clients?.['surge-macos']).toContain('http-listen = 127.0.0.1:7890');
    expect(migrated.config.kernels?.surge).toContain('*.example.test = server:1.1.1.1');
    expect(store.getWithOwner('preset', 'p')).toMatchObject({ owner: 'owner', updatedAt: 123 });
    expect(store.get('ruleset', 'r')?.overrides).toHaveLength(1);
    expect((store.get('ruleset', 'r') as any).migrationNotes.join('')).toContain('已停用并备份');
    const backup = store.db.prepare("SELECT data FROM native_migration_backups WHERE kind='preset' AND id='p'").get() as { data: string };
    expect(backup.data).not.toContain('223.5.5.5'); expect(JSON.parse(cipher.decrypt(backup.data))).toEqual(preset);
    store.close(); store = new Store(file, { cipher }); expect(store.get('preset', 'p')).toEqual(migrated);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
