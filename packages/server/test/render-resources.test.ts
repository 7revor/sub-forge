import { issueProfileToken } from './helpers.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { remoteRuleMatcher } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { Cipher } from '../src/crypto.ts';
import type { ProfileDoc, TemplateVersionDoc } from '../src/docs.ts';
import { RenderService, TOKEN_PLACEHOLDER, type StoredRender } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const template = (version = 1, name = '旧前置'): TemplateVersionDoc => ({ id: 't', name: '模板', version, groups: [{ id: 'g', name, type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [{ id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'group', groupId: 'g' } }], final: { kind: 'group', groupId: 'g' } });
const profile: ProfileDoc = { id: 'p', name: 'P', template: { id: 't', follow: 'latest' }, nodeSets: [{ ref: { type: 'source', id: 's' }, output: 'provider' }], overlay: { groupPatches: { g: { addMembers: [{ kind: 'builtin', name: 'REJECT' }] } } }, chains: [{ id: 'c', landing: { nodeSet: { type: 'source', id: 's' }, filter: '^落地' }, via: { kind: 'group', groupId: 'g' } }], refPolicy: { default: 'wrap' } };
const path = (url: string) => { const u = new URL(url, 'https://sub.test'); return u.pathname + u.search; };
const urls = (cfg: any) => ({ provider: cfg['proxy-providers'].S.url as string, ruleset: cfg['rule-providers'].R.url as string });
const version = (url: string) => new URL(url).searchParams.get('version');
function harness(store = new Store(':memory:')) {
  let now = 1000;
  const bodies = { source: 'proxies:\n  - { name: 落地 A, type: socks5, server: node.test, port: 1080 }\n', rules: 'DOMAIN,old.example.test' };
  const snapshots = new SnapshotService(store, async url => ({ status: 200, body: url.endsWith('/rules') ? bodies.rules : bodies.source }), () => now);
  const renderer = new RenderService(store, snapshots, { publicUrl: 'https://sub.test' });
  const app = createApp({ store, renderer, snapshots });
  const get = (url: string) => app.request(path(url));
  const main = async (suffix = '') => parse(await (await get(`/subs/profile?token=token&id=p${suffix.replace('?', '&')}`)).text());
  return { store, renderer, snapshots, app, bodies, get, main, advance: () => { now += 100_000_000; } };
}
function seed(store: Store) {
  store.put('source', { id: 's', name: 'S', url: 'https://example.test/source', pipeline: [] });
  store.put('ruleset', { id: 'rs', name: 'R', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [{ id: 's1', kind: 'remote', format: 'classical', url: 'https://example.test/rules' }] });
  store.putTemplateVersion(template());
  store.put('profile', structuredClone(profile));
  issueProfileToken(store, { token: 'token', profileId: 'p' });
}

describe('订阅资源按当前配置独立刷新', () => {
  it('模板修改后原地址直接返回当前前置，个人覆盖仍生效', async () => {
    const h = harness(); seed(h.store);
    const oldMain = await h.main('?platform=macos');
    const oldUrls = urls(oldMain);
    h.store.putTemplateVersion(template(2, '新前置'));
    expect(parse(await (await h.get(oldUrls.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    const newMain = await h.main('?platform=macos');
    const newUrls = urls(newMain);
    expect(version(oldUrls.provider)).toBeNull();
    expect(newUrls.provider).toBe(oldUrls.provider);
    expect(newUrls.ruleset).toBe(oldUrls.ruleset);
    expect(newMain['proxy-groups'][0]).toMatchObject({ name: '新前置', proxies: ['DIRECT', 'REJECT'] });
    expect(parse(await (await h.get(oldUrls.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    expect(parse(await (await h.get(newUrls.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    // 修改规则定义后旧资源仍存在，新模板可采用不同的规则集桶。
    h.store.put('ruleset', { id: 'rs', name: 'R', sources: [{ id: 's1', kind: 'local', format: 'classical', content: 'IP-CIDR,203.0.113.0/24' }] });
    expect(urls(await h.main('?platform=macos')).ruleset).toBe(oldUrls.ruleset);
    expect(await (await h.get(oldUrls.ruleset)).text()).toBe('IP-CIDR,203.0.113.0/24\n');
  });

  it('锁定模板版本不会随模板发布改变', async () => {
    const h = harness(); seed(h.store);
    h.store.put('profile', { ...profile, template: { id: 't', follow: { pinned: 1 } } });
    const before = await h.main();
    h.store.putTemplateVersion(template(2, '新前置'));
    expect(await h.main()).toEqual(before);
  });

  it('远程节点和规则内容更新保持地址，原资源 URL 独立刷新', async () => {
    const h = harness(); seed(h.store);
    const before = await h.main();
    const old = urls(before);
    h.bodies.source += '  - { name: 落地 B, type: socks5, server: second.test, port: 1080 }\n';
    h.bodies.rules = 'DOMAIN,new.example.test';
    h.advance();
    await h.get(old.provider); await h.snapshots.settled();
    expect(parse(await (await h.get(old.provider)).text()).proxies.map((p: any) => p.name)).toEqual(['落地 A', '落地 B']);
    expect(await (await h.get(old.ruleset)).text()).toBe('DOMAIN,new.example.test\n');
    const next = urls(await h.main());
    expect(next).toEqual(old);
    expect(new URL(next.provider).searchParams.has('hash')).toBe(false);
  });

  it('同源不同订阅的整集覆写隔离，新增节点和链修改直接生效', async () => {
    const h = harness(); seed(h.store);
    const whole = { ...structuredClone(profile), chains: [{ ...profile.chains[0]!, landing: { nodeSet: profile.chains[0]!.landing.nodeSet } }] };
    h.store.put('profile', whole);
    h.store.put('profile', { ...structuredClone(whole), id: 'p2', chains: [{ ...whole.chains[0]!, via: { kind: 'builtin', name: 'DIRECT' } }] });
    h.store.db.prepare("UPDATE docs SET owner = ? WHERE kind='profile' AND id='p2'").run(h.store.getToken('token')!.userId);
    const first = await h.main(); const old = urls(first);
    expect(first['proxy-providers'].S.override).toBeUndefined();
    const second = parse(await (await h.get('/subs/profile?token=token&id=p2')).text());
    expect(parse(await (await h.get(urls(second).provider)).text()).proxies[0]['dialer-proxy']).toBe('DIRECT');
    expect(parse(await (await h.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('旧前置');
    h.bodies.source += '  - { name: 新落地, type: socks5, server: new.test, port: 1080 }\n'; h.advance();
    await h.get(old.provider); await h.snapshots.settled();
    expect(parse(await (await h.get(old.provider)).text()).proxies.map((n: any) => n['dialer-proxy'])).toEqual(['旧前置', '旧前置']);
    h.store.putTemplateVersion(template(2, '新前置'));
    const current = urls(await h.main());
    expect(current.provider).toBe(old.provider);
    expect(parse(await (await h.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    expect(parse(await (await h.get(current.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    h.store.close();
  });

  it('资源地址不再接受版本参数，撤销 token 后不可访问', async () => {
    const h = harness(); seed(h.store);
    const old = urls(await h.main());
    const missing = new URL(old.provider); missing.searchParams.set('version', '0'.repeat(32));
    expect((await h.get(missing.toString())).status).toBe(400);
    missing.searchParams.delete('version'); missing.searchParams.set('hash', 'old');
    expect((await h.get(missing.toString())).status).toBe(400);
    h.store.deleteToken('token');
    for (const url of [old.provider, old.ruleset, '/subs/profile?token=token&id=p']) expect((await h.get(url)).status).toBe(404);
  });

  it('多次修改配置仍通过同一地址返回当前内容，不保存历史版本', async () => {
    const h = harness(); seed(h.store);
    const old = urls(await h.main());
    for (let v = 2; v <= 34; v++) { h.store.putTemplateVersion(template(v, `前置 ${v}`)); await h.main(); }
    expect(parse(await (await h.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('前置 34');
    expect(h.store.db.prepare("SELECT name FROM sqlite_master WHERE name='render_generations'").get()).toBeUndefined();
    expect((await h.get(urls(await h.main()).provider)).status).toBe(200);
  });

  it('生成失败仍使用最近一次成功结果', async () => {
    const h = harness(); seed(h.store);
    const first = await h.main();
    h.store.put('profile', { ...profile, name: '临时名称' }); await h.main();
    h.store.put('profile', structuredClone(profile)); expect(await h.main()).toEqual(first);
    h.store.putTemplateVersion({ ...template(2), final: { kind: 'group', groupId: 'missing' } });
    expect(await h.main()).toEqual(first);
    expect((await h.get(urls(first).provider)).status).toBe(200);
    expect((await h.get(urls(first).ruleset)).status).toBe(200);
  });

  it('最近成功结果加密持久化，重启读取当前资源；删除订阅时清理', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-generations-'));
    const file = join(dir, 'db.sqlite'); const cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher });
    try {
      const first = harness(store); seed(store);
      const old = urls(await first.main());
      store.putTemplateVersion(template(2, '新前置')); await first.main();
      expect(JSON.stringify(store.db.prepare('SELECT * FROM last_good').all())).not.toContain('node.test');
      store.close(); store = new Store(file, { cipher });
      const restarted = harness(store);
      expect(parse(await (await restarted.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
      store.deleteProfileData('p');
      expect(store.db.prepare('SELECT * FROM last_good').all()).toEqual([]);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('旧版 provider 路径和短版本均拒绝访问', async () => {
    const h = harness(); seed(h.store);
    const legacy: StoredRender = { yaml: `proxy-providers:\n  S:\n    url: https://sub.test/p/${TOKEN_PLACEHOLDER}/source%3As?v=1234abcd\n`, providers: { 'source:s': 'proxies: []\n' }, ruleResources: [], nodeDependencies: [], warnings: 0 };
    h.store.putLastGood('p', 'mihomo:macos', legacy);
    await h.main('?platform=macos');
    expect((await h.get('/p/token/source%3As?v=1234abcd')).status).toBe(404);
    expect((await h.get('/p/token/source%3As?v=deadbeef')).status).toBe(404);
  });
});

it('专属规则无版本参数，订阅名称变化后原地址仍取得更新内容', async () => {
  const h = harness(); seed(h.store);
  try {
    const current = template();
    h.store.putTemplateVersion({ ...current, rules: [{ ...current.rules[0]!, matcher: remoteRuleMatcher('https://example.test/rules') }] });
    const config = await h.main();
    const url = Object.values<{ url: string }>(config['rule-providers'])[0]!.url;
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ profile: 'p', key: expect.any(String), target: 'mihomo', token: 'token' });
    h.store.put('profile', { ...h.store.get('profile', 'p')!, name: '新名称' });
    h.bodies.rules = 'DOMAIN,updated.example.test'; h.advance();
    expect(await (await h.get(url)).text()).toBe('DOMAIN,updated.example.test\n');
    h.store.putTemplateVersion({ ...current, rules: [] });
    expect((await h.get(url)).status).toBe(404);
  } finally { await h.snapshots.settled(); h.store.close(); }
});

it('本地节点内容修改后原地址立即返回当前凭据', async () => {
  const h = harness(); seed(h.store);
  try {
    const owner = h.store.getToken('token')!.userId;
    const local = { id: 'local', name: '本地节点', proxies: [{ name: '测试节点', type: 'trojan' as const, server: 'node.test', port: 443, password: 'old-fixture' }] };
    h.store.put('local', local, owner);
    h.store.put('profile', { ...profile, chains: [], nodeSets: [{ ref: { type: 'local', id: local.id }, output: 'provider' }] }, owner);
    const url = (await h.main())['proxy-providers'][local.name].url;
    h.store.put('local', { ...local, proxies: [{ ...local.proxies[0]!, password: 'new-fixture' }] }, owner);
    expect(parse(await (await h.get(url)).text()).proxies[0].password).toBe('new-fixture');
    expect((await h.main())['proxy-providers'][local.name].url).toBe(url);
  } finally { await h.snapshots.settled(); h.store.close(); }
});

it('v26 升级删除结构版本与旧渲染缓存，保留配置、令牌和上游快照，重启幂等', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-resource-migration-'));
  const file = join(dir, 'db.sqlite'), cipher = new Cipher(randomBytes(32));
  let store = new Store(file, { cipher });
  try {
    seed(store);
    const saved = store.getWithOwner('profile', 'p'), token = store.getToken('token');
    store.addSnapshot({ ownerKind: 'source', ownerId: 's', url: 'https://example.test/source', fetchedAt: 1000, ok: true, status: 200, body: '旧成功原文' });
    const legacy = { generation: 'old', yaml: 'version=old&hash=old' };
    store.putLastGood('p', 'mihomo:any', legacy);
    store.db.exec('CREATE TABLE render_generations (profile_id TEXT, target TEXT, version TEXT, sequence INTEGER, data TEXT)');
    store.db.prepare('INSERT INTO render_generations VALUES (?, ?, ?, ?, ?)').run('p', 'mihomo:any', 'old', 1, cipher.encrypt(JSON.stringify(legacy)));
    store.db.pragma('user_version = 26'); store.close();
    store = new Store(file, { cipher });
    expect(store.db.pragma('user_version', { simple: true })).toBe(27);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name='render_generations'").get()).toBeUndefined();
    expect(store.getLastGood('p', 'mihomo:any')).toBeUndefined();
    expect(store.getWithOwner('profile', 'p')).toEqual(saved);
    expect(store.getToken('token')).toEqual(token);
    expect(store.latestSnapshot('source', 's', 'https://example.test/source')?.body).toBe('旧成功原文');
    store.putLastGood('p', 'mihomo:any', { yaml: '无版本的新结果' });
    store.close(); store = new Store(file, { cipher });
    expect(store.getLastGood('p', 'mihomo:any')?.data).toEqual({ yaml: '无版本的新结果' });
    expect(store.getToken('token')).toEqual(token);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
