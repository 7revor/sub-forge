import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';

const T = (version: number) => ({ id: 'std', version, groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } });

describe('Store', () => {
  it('文档读写与覆盖', () => {
    const s = new Store(':memory:');
    s.put('source', { id: 'a', name: 'A', url: 'https://a.test/sub', pipeline: [] });
    s.put('source', { id: 'a', name: 'A2', url: 'https://a.test/sub', pipeline: [] });
    expect(s.get('source', 'a')!.name).toBe('A2');
    expect(s.get('source', 'missing')).toBeUndefined();
    expect(s.list('source')).toHaveLength(1);
  });

  it('模板按版本保存，缺省取最新', () => {
    const s = new Store(':memory:');
    s.importSeed({ templates: [T(1), T(3), T(2)] });
    expect(s.getTemplate('std')!.version).toBe(3);
    expect(s.getTemplate('std', 2)!.version).toBe(2);
    expect(s.getTemplate('std', 9)).toBeUndefined();
  });

  it.each(['source', 'ruleset'] as const)('%s 快照：订阅源只留一次成功，规则集保留 5 份，失败只留最新一条', (kind) => {
    let t = 0;
    const s = new Store(':memory:', { now: () => t });
    try {
      for (let i = 0; i < 8; i++) s.addSnapshot({ ownerKind: kind, ownerId: 'a', url: 'u', fetchedAt: ++t, ok: true, body: `b${i}`, hash: `h${i}` });
      for (let i = 0; i < 3; i++) s.addSnapshot({ ownerKind: kind, ownerId: 'a', url: 'u', fetchedAt: ++t, ok: false, error: `e${i}` });
      expect(s.countSnapshots(kind, 'a', 'u')).toEqual({ ok: kind === 'source' ? 1 : 5, failed: 1 });
      expect(s.latestSnapshot(kind, 'a', 'u')!.body).toBe('b7');
      expect(s.latestSnapshot(kind, 'a', 'u', false)!.error).toBe('e2');
    } finally { s.close(); }
  });

  it('订阅源换地址后不累积成功历史，不把旧地址内容用作新地址的快照', () => {
    const s = new Store(':memory:');
    try {
      s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url: 'old', fetchedAt: 1, ok: true, body: '旧内容' });
      s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url: 'new', fetchedAt: 2, ok: false, error: '失败' });
      expect(s.latestSnapshot('source', 'a', 'new')).toBeUndefined();
      expect(s.latestSnapshot('source', 'a', 'old')?.body).toBe('旧内容');
      s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url: 'new', fetchedAt: 3, ok: true, body: '新内容' });
      expect(s.latestSnapshot('source', 'a', 'old')).toBeUndefined();
      expect(s.snapshotHistory('source', 'a').filter(row => row.ok)).toHaveLength(1);
    } finally { s.close(); }
  });

  it('token、最近一次成功渲染、访问日志', () => {
    const s = new Store(':memory:', { now: () => 42 });
    s.putToken({ token: 'tk', profileId: 'p', label: 'Mac' });
    expect(s.getToken('tk')).toEqual({ token: 'tk', profileId: 'p', label: 'Mac' });
    s.putLastGood('p', 'mihomo', { yaml: 'a' });
    expect(s.getLastGood('p', 'mihomo')).toEqual({ renderedAt: 42, data: { yaml: 'a' } });
    s.logAccess({ token: 'tk', profileId: 'p', at: 1, ua: 'clash.meta', client: 'mihomo', status: 200, ms: 3, warnings: 0, source: 'fresh' });
    expect(s.recentAccess('p')).toHaveLength(1);
  });
});

describe('加密与迁移', () => {
  it.each([13, 14])('v%i 升级清理订阅源旧拉取选项和成功历史，保持归属、更新时间、规则集和重复启动一致', (version) => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-source-policy-'));
    const file = join(dir, 'v13.db');
    const cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher, now: () => 42 });
    try {
      const legacy = { id: 's', name: '旧订阅源', url: 'https://a.test/sub', pipeline: [], fetch: { ua: '旧 UA', timeoutMs: 1500, ttlSec: 7200 } };
      store.db.prepare("INSERT INTO docs (kind, id, owner, data, updated_at) VALUES ('source', 's', 'u1', ?, 42)").run(cipher.encrypt(JSON.stringify(legacy)));
      store.put('ruleset', { id: 'r', name: '规则集', sources: [{ id: 'remote', kind: 'remote', format: 'auto', url: 'https://r.test/list', fetch: { ua: '规则 UA', timeoutMs: 2000 } }] }, 'u1');
      const insert = store.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, url_hash, fetched_at, ok, body, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const kind of ['source', 'ruleset']) {
        const id = kind === 'source' ? 's' : 'r';
        for (let i = 0; i < 5; i++) insert.run(kind, id, cipher.encrypt(legacy.url), cipher.hmac(legacy.url), i === 4 ? 3 : i, 1, cipher.encrypt(`内容${i}`), null);
        for (let i = 0; i < 2; i++) insert.run(kind, id, cipher.encrypt(legacy.url), cipher.hmac(legacy.url), 10 + i, 0, null, cipher.encrypt(`失败${i}`));
      }
      store.db.pragma(`user_version = ${version}`);
      store.close();
      store = new Store(file, { cipher });
      expect(store.getWithOwner('source', 's')).toMatchObject({ owner: 'u1', updatedAt: 42, doc: { fetch: { ttlSec: 7200 } } });
      expect(store.get('source', 's')?.fetch).toEqual({ ttlSec: 7200 });
      expect(store.snapshotHistory('source', 's')).toHaveLength(2);
      expect(store.latestSnapshot('source', 's', legacy.url)?.body).toBe('内容4');
      expect(store.latestSnapshot('source', 's', legacy.url, false)?.error).toBe('失败1');
      expect(store.snapshotHistory('ruleset', 'r')).toHaveLength(7);
      expect(store.get('ruleset', 'r')?.sources[0]?.fetch).toEqual({ ua: '规则 UA', timeoutMs: 2000 });
      const before = store.snapshotHistory('source', 's');
      store.close();
      store = new Store(file, { cipher });
      expect(store.snapshotHistory('source', 's')).toEqual(before);
      // 旧种子导入也不能恢复自定义拉取选项。
      store.importSeed({ sources: [legacy] });
      expect(store.get('source', 's')?.fetch).toEqual({ ttlSec: 7200 });
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('文档、快照正文、token 落盘时加密；token 按 HMAC 查找', () => {
    const s = new Store(':memory:');
    s.put('source', { id: 'a', name: 'A', url: 'https://secret.example.com/sub?token=xyz', pipeline: [] }, 'u1');
    const url = 'https://secret.example.com/sub?token=xyz';
    s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url, fetchedAt: 1, ok: true, body: 'password: hunter2', error: `连接 ${url} 失败` });
    const t = s.createToken('p', 'Mac');
    const dump = JSON.stringify([
      s.db.prepare('SELECT * FROM docs').all(),
      s.db.prepare('SELECT * FROM snapshots').all(),
      s.db.prepare('SELECT * FROM sub_tokens').all(),
    ]);
    expect(dump).not.toContain('secret.example.com');
    expect(dump).not.toContain('hunter2');
    expect(dump).not.toContain(t.token);
    expect(s.get('source', 'a')!.url).toEqual('https://secret.example.com/sub?token=xyz');
    expect(s.getWithOwner('source', 'a')!.owner).toBe('u1');
    expect(s.latestSnapshot('source', 'a', url)).toMatchObject({ url, body: 'password: hunter2', error: `连接 ${url} 失败` });
    expect(s.snapshotHistory('source', 'a')[0]!.url).toBe(url);
    expect(s.getToken(t.token)).toEqual({ token: t.token, profileId: 'p', label: 'Mac' });
    expect(s.listTokens('p').map((x) => x.token)).toEqual([t.token]);
  });

  it('旧版数据库（docs 无 owner、token 明文）自动升级', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-mig-'));
    const file = join(dir, 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE docs (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
      CREATE TABLE tokens (token TEXT PRIMARY KEY, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL);
      INSERT INTO docs VALUES ('profile', 'p', '{"id":"p","name":"旧"}', 1);
      INSERT INTO tokens VALUES ('old-token', 'p', NULL, 1);`);
    old.close();
    const s = new Store(file, { cipher: new Cipher(randomBytes(32)) });
    expect(s.get('profile', 'p')!.name).toBe('旧');
    expect(s.getToken('old-token')).toEqual({ token: 'old-token', profileId: 'p' });
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('v4 的本地内容订阅源迁移为本地节点组：节点为处理链结果，引用改指向本地节点组', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-mig-'));
    const file = join(dir, 'v4.db');
    const cipher = new Cipher(randomBytes(32));
    const old = new Store(file, { cipher });
    const content = 'proxies:\n  - { name: 香港 01, type: trojan, server: hk.test, port: 443, password: p, dialer-proxy: 中转 }\n  - { name: 中转, type: socks5, server: relay.test, port: 1080 }\n  - { name: 剩余流量：10G, type: trojan, server: info.test, port: 443, password: p }\n';
    const legacy = { id: 'L', name: '手写', kind: 'local', content, pipeline: [{ op: 'filter.useless' }, { op: 'rename.affix', prefix: 'A·' }] };
    old.put('source', legacy as never, 'u1');
    old.put('source', { id: 'R', name: '远程', url: 'https://r.test/sub', pipeline: [] }, 'u1');
    old.put('collection', { id: 'c', name: 'C', members: [{ ref: { type: 'source', id: 'L' }, prefix: 'x' }, { ref: { type: 'source', id: 'R' } }], pipeline: [] }, 'u1');
    old.put('profile', { id: 'p', name: 'P', nodeSets: [{ ref: { type: 'source', id: 'L' }, output: 'inline' }], overlay: {}, chains: [{ id: 'ch', landing: { nodeSet: { type: 'source', id: 'L' } }, via: { kind: 'builtin', name: 'DIRECT' } }], refPolicy: { default: 'wrap' } }, 'u1');
    old.db.pragma('user_version = 4');
    old.close();

    const s = new Store(file, { cipher });
    expect(s.get('source', 'L')).toBeUndefined();
    expect(s.get('source', 'R')!.name).toBe('远程');
    expect(s.getWithOwner('local', 'L')).toMatchObject({ owner: 'u1', doc: { id: 'L', name: '手写', proxies: [
      { name: 'A·香港 01', type: 'trojan', server: 'hk.test', port: 443, password: 'p' },
      { name: 'A·中转', type: 'socks5', server: 'relay.test', port: 1080 },
    ] } });
    expect(s.get('collection', 'c')!.members.map((m) => m.ref)).toEqual([{ type: 'local', id: 'L' }, { type: 'source', id: 'R' }]);
    const p = s.get('profile', 'p')!;
    expect(p.nodeSets[0]!.ref).toEqual({ type: 'local', id: 'L' });
    expect(p.chains[0]!.landing.nodeSet).toEqual({ type: 'local', id: 'L' });
    // 上游自带的前置随后（v6）转成链规则
    expect(p.chains[1]).toMatchObject({ landing: { nodeSet: { type: 'local', id: 'L' }, filter: '^A·香港 01$' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'L' }, match: { exact: 'A·中转' } } } });
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('v5 的本地节点前置迁移为直接使用该分组的配置订阅中的链规则', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-mig-'));
    const file = join(dir, 'v5.db');
    const cipher = new Cipher(randomBytes(32));
    const old = new Store(file, { cipher });
    const via = { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: 'HK.IPLC' } } };
    old.put('local', { id: 'self', name: '自建', proxies: [
      { name: 'SG (1)', type: 'trojan', server: 'sg', port: 443, password: 'p', dialer: via },
      { name: 'JP', type: 'trojan', server: 'jp', port: 443, password: 'p', 'dialer-proxy': '别处的组' },
      { name: 'US', type: 'trojan', server: 'us', port: 443, password: 'p' },
    ] } as never, 'u1');
    old.put('collection', { id: 'c', name: 'C', members: [{ ref: { type: 'local', id: 'self' } }], pipeline: [] }, 'u1');
    const base = { overlay: {}, refPolicy: { default: 'wrap' } };
    old.put('profile', { id: 'direct', name: '直接', nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }], chains: [], ...base } as never, 'u1');
    old.put('profile', { id: 'via-col', name: '经组合', nodeSets: [{ ref: { type: 'collection', id: 'c' }, output: 'inline' }], chains: [], ...base } as never, 'u1');
    old.db.pragma('user_version = 5');
    old.close();

    const s = new Store(file, { cipher });
    expect(s.db.pragma('user_version', { simple: true })).toBe(15);
    expect(s.get('local', 'self')!.proxies.map((p) => Object.keys(p).filter((k) => k.includes('dialer') || k.includes('underlying')))).toEqual([[], [], []]);
    expect(s.get('profile', 'direct')!.chains).toEqual([{ id: expect.stringMatching(/^c_/), landing: { nodeSet: { type: 'local', id: 'self' }, filter: '^SG \\(1\\)$' }, via }]);
    expect(s.get('profile', 'via-col')!.chains).toEqual([]);
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([5, 6])('v%i 升级到 v7：规则包迁移与本地前置迁移兼容，重启不重复执行', (version) => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-mig-'));
    const file = join(dir, `v${version}.db`);
    const cipher = new Cipher(randomBytes(32));
    const old = new Store(file, { cipher });
    const raw = (kind: string, doc: { id: string }, owner: string | null) => old.db.prepare('INSERT INTO docs (kind, id, owner, data, updated_at) VALUES (?, ?, ?, ?, 0)').run(kind, doc.id, owner, cipher.encrypt(JSON.stringify(doc)));
    const overrides = [{ line: 1, override: { when: { client: 'surge' }, action: { drop: true } } }];
    raw('ruleset', { id: 'tg', name: 'Telegram', kind: 'remote', format: 'classical', url: 'https://r.test/tg.list', fetch: { ttlSec: 3600 } } as never, 'u1');
    raw('ruleset', { id: 'own', name: '自定', kind: 'local', format: 'auto', content: 'DOMAIN,a.test', overrides } as never, 'u1');
    raw('bundle', { id: 'fin', name: '金融', noResolve: true, items: [
      { kind: 'ruleset', id: 'tg' }, { kind: 'ruleset', id: 'own', enabled: false }, { kind: 'ruleset', id: 'gone' },
      { kind: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8' } }, { kind: 'rule', rule: { type: 'DOMAIN', value: 'off.test' }, enabled: false },
    ] } as never, 'u1');
    // 与已有规则集同 id 的规则包换新 id
    raw('bundle', { id: 'own', name: '撞名', items: [] } as never, 'u2');
    old.addSnapshot({ ownerKind: 'ruleset', ownerId: 'tg', url: 'https://r.test/tg.list', fetchedAt: 1, ok: true, body: 'DOMAIN,t.me', hash: 'h' });
    const via = { kind: 'builtin' as const, name: 'DIRECT' as const };
    const chain = { id: 'existing', landing: { nodeSet: { type: 'local' as const, id: 'self' }, filter: '^SG$' }, via };
    old.put('local', { id: 'self', name: '自建', proxies: [{ name: 'SG', type: 'trojan', server: 'sg.test', port: 443, password: 'p', ...(version < 6 ? { dialer: via } : {}) }] }, 'u2');
    old.put('profile', { id: 'p', name: 'P', nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }], overlay: { extraRules: [{ anchor: 'top', rule: { id: 'x', matcher: { kind: 'bundle', id: 'own' } as never, target: { kind: 'builtin', name: 'DIRECT' } } }] }, chains: version < 6 ? [] : [chain], refPolicy: { default: 'wrap' } }, 'u2');
    old.putTemplateVersion({ ...T(1), rules: [{ id: 'f', matcher: { kind: 'bundle', id: 'fin' } as never, target: { kind: 'builtin', name: 'DIRECT' } }] });
    old.db.pragma(`user_version = ${version}`);
    old.close();

    const s = new Store(file, { cipher });
    expect(s.db.pragma('user_version', { simple: true })).toBe(15);
    expect(s.get('ruleset', 'tg')).toEqual({ id: 'tg', name: 'Telegram', sources: [{ id: 's1', kind: 'remote', format: 'classical', url: 'https://r.test/tg.list', fetch: { ttlSec: 3600 } }] });
    expect(s.get('ruleset', 'own')).toEqual({ id: 'own', name: '自定', sources: [{ id: 's1', kind: 'local', format: 'auto', content: 'DOMAIN,a.test' }], overrides: [{ match: 'DOMAIN,a.test', override: overrides[0]!.override }] });
    expect(s.getWithOwner('ruleset', 'fin')).toMatchObject({ owner: 'u1', doc: { id: 'fin', name: '金融', noResolve: true, sources: [
      { id: 'tg', name: 'Telegram', kind: 'remote', url: 'https://r.test/tg.list', fetch: { ttlSec: 3600 } },
      { id: 'own', name: '自定', kind: 'local', content: 'DOMAIN,a.test', overrides, enabled: false },
      { id: 'rules', name: '单条规则', kind: 'local', format: 'classical', content: 'IP-CIDR,10.0.0.0/8' },
      { id: 'rules-off', name: '单条规则（停用）', kind: 'local', format: 'classical', content: 'DOMAIN,off.test', enabled: false },
    ] } });
    expect(s.latestSnapshot('ruleset', 'fin', 'https://r.test/tg.list')?.body).toBe('DOMAIN,t.me');
    const renamed = s.list('ruleset', 'u2');
    expect(renamed).toHaveLength(1);
    expect(renamed[0]!.id).not.toBe('own');
    expect(s.get('profile', 'p')!.overlay.extraRules![0]!.rule.matcher).toEqual({ kind: 'ruleset', id: renamed[0]!.id });
    expect(s.get('local', 'self')!.proxies[0]).not.toHaveProperty('dialer');
    const migratedProfile = s.get('profile', 'p')!;
    expect(migratedProfile.chains).toEqual([{ ...chain, id: version < 6 ? expect.stringMatching(/^c_/) : 'existing' }]);
    expect(s.getTemplate('std')!.rules[0]!.matcher).toEqual({ kind: 'ruleset', id: 'fin' });
    expect(s.db.prepare("SELECT COUNT(*) n FROM docs WHERE kind = 'bundle'").get()).toEqual({ n: 0 });
    const migratedRulesets = s.list('ruleset');
    s.close();
    const reopened = new Store(file, { cipher });
    expect(reopened.db.pragma('user_version', { simple: true })).toBe(15);
    expect(reopened.get('profile', 'p')).toEqual(migratedProfile);
    expect(reopened.list('ruleset')).toEqual(migratedRulesets);
    expect(reopened.countSnapshots('ruleset', 'fin', 'https://r.test/tg.list')).toEqual({ ok: 1, failed: 0 });
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('持久化数据库必须提供密钥', () => {
    expect(() => new Store('/tmp/never-created.db')).toThrow(/密钥/);
  });

  it('v2 快照 URL 与错误迁移为密文，查询、历史与再次启动保持有效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-url-migration-'));
    const file = join(dir, 'old.db');
    const cipher = new Cipher(randomBytes(32));
    const url = 'https://example.test/sub?token=MIGRATION_SECRET';
    try {
      const original = new Store(file, { cipher });
      original.addSnapshot({ ownerKind: 'source', ownerId: 's', url, fetchedAt: 42, ok: true, body: '旧正文' });
      original.close();
      const old = new Database(file);
      old.exec('DROP INDEX snapshots_owner; ALTER TABLE snapshots DROP COLUMN url_hash; PRAGMA user_version = 2;');
      old.prepare('UPDATE snapshots SET url = ?, body = ?, error = ?').run(url, '旧正文', `拉取 ${url} 失败`);
      old.close();
      for (let i = 0; i < 2; i++) {
        const upgraded = new Store(file, { cipher });
        expect(upgraded.latestSnapshot('source', 's', url)).toMatchObject({ url, body: '旧正文', error: `拉取 ${url} 失败` });
        expect(upgraded.countSnapshots('source', 's', url)).toEqual({ ok: 1, failed: 0 });
        expect(JSON.stringify(upgraded.db.prepare('SELECT * FROM snapshots').all())).not.toContain('MIGRATION_SECRET');
        upgraded.close();
      }
      expect(readFileSync(file).includes(Buffer.from('MIGRATION_SECRET'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

it('v7 升级到 v9：按成功快照与本地内容迁移旧行号，无内容或停用来源保留并可重试', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-group-mig-'));
  const file = join(dir, 'v7.db');
  const cipher = new Cipher(randomBytes(32));
  const old = new Store(file, { cipher });
  const override = { when: { client: 'mihomo' as const }, action: { drop: true as const } };
  old.put('ruleset', { id: 'r', name: '迁移', sources: [
    { id: 'a', kind: 'local', format: 'auto', content: '# 注释\nDOMAIN,a.test', overrides: [{ line: 2, override }] },
    { id: 'b', kind: 'remote', format: 'auto', url: 'https://example.test/list', overrides: [{ line: 1, override }] },
    { id: 'c', kind: 'remote', format: 'auto', url: 'https://example.test/missing', overrides: [{ line: 99, override }] },
    { id: 'off', kind: 'local', format: 'auto', content: 'DOMAIN,off.test', enabled: false, overrides: [{ match: 'DOMAIN,off.test', override }] },
  ] }, 'owner');
  old.addSnapshot({ ownerKind: 'ruleset', ownerId: 'r', url: 'https://example.test/list', fetchedAt: 1, ok: true, body: 'DOMAIN,b.test' });
  old.db.pragma('user_version = 7');
  old.close();
  const migrated = new Store(file, { cipher });
  const rs = migrated.get('ruleset', 'r')!;
  expect(migrated.getWithOwner('ruleset', 'r')!.owner).toBe('owner');
  expect(rs.overrides).toEqual([{ match: 'DOMAIN,a.test', override }, { match: 'DOMAIN,b.test', override }]);
  expect(rs.sources.slice(0, 2).every((s) => !s.overrides)).toBe(true);
  expect(rs.sources[2]!.overrides).toEqual([{ line: 99, override }]);
  expect(rs.sources[3]!.overrides).toHaveLength(1);
  migrated.close();
  const reopened = new Store(file, { cipher });
  expect(reopened.get('ruleset', 'r')).toEqual(rs);
  reopened.close();
  rmSync(dir, { recursive: true, force: true });
});
