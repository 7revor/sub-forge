import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const url = 'https://source.example.test/sub';
const legacy = { id: 's', name: '旧源', urls: [url], pipeline: [], fetch: { ua: 'custom' } };
const stores: Store[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('订阅源单 URL 契约', () => {
  it('创建、更新、读取统一返回 url；兼容旧版单地址请求', async () => {
    const h = setupApp(); stores.push(h.store);
    await addUser(h.store, 'alice');
    const alice = client(h.app); await alice.login('alice');
    const created = await alice.post('/api/sources', { name: '源', url: ` ${url} ` });
    expect(created.status).toBe(201);
    expect(created.json.item.url).toBe(url);
    expect(created.json.item).not.toHaveProperty('urls');
    const path = `/api/sources/${created.json.item.id}`;
    const updated = await alice.put(path, { name: '旧客户端', urls: [`${url}?v=2`] });
    expect(updated.status).toBe(200);
    expect((await alice.get(path)).json.item).toMatchObject({ name: '旧客户端', url: `${url}?v=2` });
    expect((await alice.get('/api/sources')).json.items[0]).not.toHaveProperty('urls');
    const before = h.store.list('source');
    for (const address of [{}, { url: '' }, { url: [url] }, { urls: [] }, { urls: [url, url] }, { urls: [url], url }, { url: 'file:///tmp/a' }, { url: `${url}\n${url}` }, { url: `${url} ${url}` }]) {
      expect((await alice.post('/api/sources', { name: '非法', ...address })).status).toBe(400);
      expect((await alice.put(path, { name: '非法', ...address })).status).toBe(400);
    }
    expect(h.store.list('source')).toEqual(before);
  });

  it.each([
    { label: 'v7 原始数据', version: 7, sourceMigrated: false, rulesMigrated: false },
    { label: 'v8 主分支规则已迁移', version: 8, sourceMigrated: false, rulesMigrated: true },
    { label: 'v8 开发分支地址已迁移', version: 8, sourceMigrated: true, rulesMigrated: false },
  ])('$label 升级到 v9 保留归属、时间、引用、快照，重启不重复改写', ({ version, sourceMigrated, rulesMigrated }) => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-single-url-')); dirs.push(dir);
    const file = join(dir, 'old.db');
    const cipher = new Cipher(randomBytes(32));
    const old = new Store(file, { cipher, now: () => 123 }); stores.push(old);
    old.put('source', (sourceMigrated ? { id: legacy.id, name: legacy.name, url, pipeline: [], fetch: legacy.fetch } : legacy) as never, 'alice');
    const override = { when: { client: 'mihomo' as const }, action: { drop: true as const } };
    const groupOverride = { match: 'DOMAIN,example.test', override };
    old.put('ruleset', { id: 'r', name: '规则', sources: [{ id: 'local', kind: 'local', format: 'classical', content: 'DOMAIN,example.test', ...(!rulesMigrated ? { overrides: [{ line: 1, override }] } : {}) }], ...(rulesMigrated ? { overrides: [groupOverride] } : {}) }, 'alice');
    old.put('collection', { id: 'c', name: '组合', members: [{ ref: { type: 'source', id: 's' } }], pipeline: [] }, 'alice');
    old.addSnapshot({ ownerKind: 'source', ownerId: 's', url, fetchedAt: 100, ok: true, body: '旧快照' });
    old.db.pragma(`user_version = ${version}`); old.close();
    const s = new Store(file, { cipher }); stores.push(s);
    expect(s.db.pragma('user_version', { simple: true })).toBe(9);
    expect(s.getWithOwner('source', 's')).toMatchObject({ owner: 'alice', doc: { id: 's', url, fetch: legacy.fetch } });
    expect(s.get('source', 's')).not.toHaveProperty('urls');
    expect(s.getWithOwner('ruleset', 'r')).toMatchObject({ owner: 'alice', doc: { overrides: [groupOverride] } });
    expect(s.get('ruleset', 'r')!.sources[0]).not.toHaveProperty('overrides');
    expect(s.db.prepare("SELECT updated_at FROM docs WHERE kind = 'source'").get()).toEqual({ updated_at: 123 });
    expect(s.get('collection', 'c')!.members).toEqual([{ ref: { type: 'source', id: 's' } }]);
    expect(s.latestSnapshot('source', 's', url)?.body).toBe('旧快照');
    const rows = s.db.prepare('SELECT * FROM docs').all(); s.close();
    const reopened = new Store(file, { cipher }); stores.push(reopened);
    expect(reopened.db.prepare('SELECT * FROM docs').all()).toEqual(rows);
  });

  it.each([7, 8])('v%i 意外多地址数据迁移失败时整批回滚，保留原始地址', (version) => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-single-url-')); dirs.push(dir);
    const file = join(dir, 'old.db');
    const cipher = new Cipher(randomBytes(32));
    const old = new Store(file, { cipher }); stores.push(old);
    old.put('source', legacy as never);
    old.put('source', { ...legacy, id: 'multi', urls: [url, `${url}?v=2`] } as never);
    old.db.pragma(`user_version = ${version}`);
    const rows = old.db.prepare('SELECT * FROM docs').all(); old.close();
    expect(() => new Store(file, { cipher })).toThrow(/只允许一个 URL/);
    const db = new Database(file);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(version);
      expect(db.prepare('SELECT * FROM docs').all()).toEqual(rows);
    } finally { db.close(); }
  });

  it('旧单地址种子转换为 url，多地址种子导入整批回滚', () => {
    const s = new Store(':memory:'); stores.push(s);
    s.importSeed({ sources: [legacy as never] }, 'alice');
    expect(s.get('source', 's')?.url).toBe(url);
    expect(s.get('source', 's')).not.toHaveProperty('urls');
    const before = s.list('source');
    expect(() => s.importSeed({ sources: [
      { id: 'new', name: '新源', url, pipeline: [] },
      { ...legacy, name: '不应覆盖', urls: [url, `${url}?v=2`] } as never,
    ] })).toThrow(/只允许一个 URL/);
    expect(s.list('source')).toEqual(before);
  });
});
