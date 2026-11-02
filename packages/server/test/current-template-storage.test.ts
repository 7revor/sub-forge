import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';

const template = { id: 't', name: '当前模板', groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
const legacyTable = 'CREATE TABLE template_versions (template_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (template_id, version))';

it('v30 模板转入单主键当前表，保留原文和时间；重启与分页稳定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-template-storage-'));
  const file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  try {
    store.db.exec(legacyTable);
    store.db.prepare('INSERT INTO template_versions VALUES (?,1,?,1234)').run(template.id, JSON.stringify(template));
    store.db.exec('DROP TABLE templates; PRAGMA user_version = 30');
    store.close(); store = new Store(file, { cipher });
    expect(store.getTemplate('t')).toEqual(template);
    expect(store.getTemplate('t', 1)).toBeUndefined();
    expect(store.db.prepare('SELECT updated_at FROM templates').get()).toEqual({ updated_at: 1234 });
    expect((store.db.prepare('PRAGMA table_info(templates)').all() as { name: string }[]).map(c => c.name)).toEqual(['id', 'data', 'updated_at']);
    expect(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'template_versions'").get()).toBeUndefined();
    expect(store.listTemplatesPage({ page: 1, pageSize: 10, q: '' }).items).toEqual([template]);
    store.close(); store = new Store(file, { cipher });
    expect(store.listTemplates()).toEqual([template]);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

it('旧种子临时解析锁定版本，不覆盖无关模板；失败整批回滚并销毁临时结构', () => {
  const store = new Store(':memory:');
  try {
    store.putTemplate({ ...template, id: 'keep' });
    const old = { ...template, version: 1, final: { kind: 'builtin' as const, name: 'REJECT' as const } };
    const profile = { id: 'p', name: '锁定', nodeSets: [], chains: [], overlay: {}, template: { id: 't', follow: { pinned: 1 } } };
    store.importSeed({ templates: [old, { ...template, version: 2 }], profiles: [profile] });
    expect(store.listTemplates()).toEqual([{ ...template, id: 'keep' }, template]);
    expect(store.get('profile', 'p')?.routing).toMatchObject({ mode: 'independent', config: { final: old.final } });
    expect(store.getProfileMigrationBackup('p')).toEqual(profile);
    expect(store.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'template_versions'").get()).toBeUndefined();
    const before = store.listTemplates();
    expect(() => store.importSeed({ templates: [{ ...template, name: '不应保存' }], profiles: [{ ...profile, template: { id: 'missing', follow: { pinned: 1 } } }] })).toThrow('模板版本缺失');
    expect(store.listTemplates()).toEqual(before);
    expect(store.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name = 'template_versions'").get()).toBeUndefined();
    expect(store.getTemplate('t')).toEqual(template);
  } finally { store.close(); }
});
