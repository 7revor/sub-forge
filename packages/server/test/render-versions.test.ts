import { issueProfileToken } from './helpers.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
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
const version = (url: string) => new URL(url).searchParams.get('v');
function harness(store = new Store(':memory:')) {
  let now = 1000;
  const bodies = { source: 'proxies:\n  - { name: 落地 A, type: socks5, server: node.test, port: 1080 }\n', rules: 'DOMAIN,old.example.test' };
  const snapshots = new SnapshotService(store, async url => ({ status: 200, body: url.endsWith('/rules') ? bodies.rules : bodies.source }), () => now);
  const renderer = new RenderService(store, snapshots, { publicUrl: 'https://sub.test' });
  const app = createApp({ store, renderer, snapshots });
  const get = (url: string) => app.request(path(url));
  const main = async (suffix = '') => parse(await (await get(`/sub/token/p${suffix}`)).text());
  return { store, renderer, snapshots, app, bodies, get, main, advance: () => { now += 100_000_000; } };
}
function seed(store: Store) {
  store.put('source', { id: 's', name: 'S', url: 'https://example.test/source', pipeline: [] });
  store.put('ruleset', { id: 'rs', name: 'R', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [{ id: 's1', kind: 'remote', format: 'classical', url: 'https://example.test/rules' }] });
  store.putTemplateVersion(template());
  store.put('profile', structuredClone(profile));
  issueProfileToken(store, { token: 'token', profileId: 'p' });
}

describe('订阅结构版本与独立刷新', () => {
  it('跟随模板更新时新旧主配置分别取得兼容资源，个人覆盖仍生效', async () => {
    const h = harness(); seed(h.store);
    const oldMain = await h.main('?platform=macos');
    const oldUrls = urls(oldMain);
    h.store.putTemplateVersion(template(2, '新前置'));
    const newMain = await h.main('?platform=macos');
    const newUrls = urls(newMain);
    expect(version(oldUrls.provider)).not.toBe(version(newUrls.provider));
    expect(newUrls.ruleset).toBe(oldUrls.ruleset);
    expect(newMain['proxy-groups'][0]).toMatchObject({ name: '新前置', proxies: ['DIRECT', 'REJECT'] });
    expect(parse(await (await h.get(oldUrls.provider)).text()).proxies[0]['dialer-proxy']).toBe('旧前置');
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

  it('远程节点和规则的兼容内容更新保持版本，旧资源 URL 仍独立刷新', async () => {
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
    expect(version(next.provider)).toBe(version(old.provider));
    expect(new URL(next.provider).searchParams.get('h')).not.toBe(new URL(old.provider).searchParams.get('h'));
  });

  it('同源不同订阅的整集覆写隔离，新增节点沿用前置，旧版本保留旧链', async () => {
    const h = harness(); seed(h.store);
    const whole = { ...structuredClone(profile), chains: [{ ...profile.chains[0]!, landing: { nodeSet: profile.chains[0]!.landing.nodeSet } }] };
    h.store.put('profile', whole);
    h.store.put('profile', { ...structuredClone(whole), id: 'p2', chains: [{ ...whole.chains[0]!, via: { kind: 'builtin', name: 'DIRECT' } }] });
    h.store.db.prepare("UPDATE docs SET owner = ? WHERE kind='profile' AND id='p2'").run(h.store.getToken('token')!.userId);
    const first = await h.main(); const old = urls(first);
    expect(first['proxy-providers'].S.override).toBeUndefined();
    const second = parse(await (await h.get('/sub/token/p2')).text());
    expect(parse(await (await h.get(urls(second).provider)).text()).proxies[0]['dialer-proxy']).toBe('DIRECT');
    expect(parse(await (await h.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('旧前置');
    h.bodies.source += '  - { name: 新落地, type: socks5, server: new.test, port: 1080 }\n'; h.advance();
    await h.get(old.provider); await h.snapshots.settled();
    expect(parse(await (await h.get(old.provider)).text()).proxies.map((n: any) => n['dialer-proxy'])).toEqual(['旧前置', '旧前置']);
    h.store.putTemplateVersion(template(2, '新前置'));
    const current = urls(await h.main());
    expect(version(current.provider)).not.toBe(version(old.provider));
    expect(parse(await (await h.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('旧前置');
    expect(parse(await (await h.get(current.provider)).text()).proxies[0]['dialer-proxy']).toBe('新前置');
    h.store.close();
  });

  it('版本不存在不冒充最新内容，撤销 token 后历史版本也不可访问', async () => {
    const h = harness(); seed(h.store);
    const old = urls(await h.main());
    const missing = new URL(old.provider); missing.searchParams.set('v', '0'.repeat(32));
    expect((await h.get(missing.toString())).status).toBe(404);
    h.store.deleteToken('token');
    for (const url of [old.provider, old.ruleset, '/sub/token/p']) expect((await h.get(url)).status).toBe(404);
  });

  it('保留最近 32 个结构版本，过期地址明确失效而不返回新结构', async () => {
    const h = harness(); seed(h.store);
    const old = urls(await h.main());
    for (let v = 2; v <= 34; v++) { h.store.putTemplateVersion(template(v, `前置 ${v}`)); await h.main(); }
    expect(h.store.db.prepare('SELECT version FROM render_generations').all()).toHaveLength(32);
    expect((await h.get(old.provider)).status).toBe(404);
    expect((await h.get(urls(await h.main()).provider)).status).toBe(200);
    expect(h.store.db.prepare('SELECT version FROM render_generations').all()).toHaveLength(32);
  });

  it('失败回退返回完整旧版本；缓存命中恢复后的配置成为新的 last-good', async () => {
    const h = harness(); seed(h.store);
    const first = await h.main();
    h.store.put('profile', { ...profile, name: '临时名称' }); await h.main();
    h.store.put('profile', structuredClone(profile)); expect(await h.main()).toEqual(first);
    h.store.putTemplateVersion({ ...template(2), final: { kind: 'group', groupId: 'missing' } });
    expect(await h.main()).toEqual(first);
    expect((await h.get(urls(first).provider)).status).toBe(200);
    expect((await h.get(urls(first).ruleset)).status).toBe(200);
  });

  it('旧版本加密持久化，服务重启后仍可读取；删除 Profile 时清理', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-generations-'));
    const file = join(dir, 'db.sqlite'); const cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher });
    try {
      const first = harness(store); seed(store);
      const old = urls(await first.main());
      store.putTemplateVersion(template(2, '新前置')); await first.main();
      expect(JSON.stringify(store.db.prepare('SELECT * FROM render_generations').all())).not.toContain('node.test');
      store.close(); store = new Store(file, { cipher });
      const restarted = harness(store);
      expect(parse(await (await restarted.get(old.provider)).text()).proxies[0]['dialer-proxy']).toBe('旧前置');
      store.deleteProfileData('p');
      expect(store.db.prepare('SELECT * FROM render_generations').all()).toEqual([]);
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
