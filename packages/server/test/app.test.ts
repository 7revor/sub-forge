import { stringify as testYaml } from 'yaml';
import { issueProfileToken } from './helpers.ts';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { detectClient } from '../src/client.ts';
import type { ProfileDoc, Seed } from '../src/docs.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const AIRPORT = `proxies:
  - { name: 香港 01, type: trojan, server: hk.example.com, port: 443, password: a }
  - { name: 日本 01, type: trojan, server: jp.example.com, port: 443, password: b }
  - { name: 剩余流量：10G, type: trojan, server: x.example.com, port: 443, password: c }
`;

const PROFILE: NonNullable<Seed['profiles']>[number] = {
  id: 'p1', name: '落地链路',
  template: { id: 'std', follow: 'latest' },
  base: { presetId: 'fakeip', kernels: {mihomo: testYaml({ 'allow-lan': true }) } },
  nodeSets: [{ ref: { type: 'source', id: 'air' }, output: 'provider' }, { ref: { type: 'local', id: 'self' }, output: 'inline' }],
  overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'air' } }], set: { filter: 'HK' } } } },
  chains: [{ id: 'c1', landing: { nodeSet: { type: 'local', id: 'self' } }, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'air' }, match: { exact: '🇭🇰 HK-01' } } } }],
  refPolicy: { default: 'wrap' },
};

const SEED: Seed = {
  sources: [{ id: 'air', name: '机场 A', url: 'https://air.example.com/sub', pipeline: [{ op: 'filter.useless' }, { op: 'rename.regex', rules: [{ pattern: '^香港\\s*(\\d+)', replace: 'HK-$1' }] }, { op: 'flag', mode: 'add' }] }],
  locals: [{ id: 'self', name: '自建', proxies: [{ name: '自建 SG', type: 'trojan', server: 'sg.example.com', port: 443, password: 's' }] }],
  rulesets: [{ id: 'tg', name: 'Telegram', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [{ id: 's1', kind: 'remote', format: 'auto', url: 'https://rules.example.com/telegram.list' }] }],
  presets: [{ id: 'fakeip', name: 'fake-ip 推荐', version: 1, config: { kernels: {mihomo: testYaml({ 'mixed-port': 7890, dns: { enable: true, 'enhanced-mode': 'fake-ip' } }) } } }],
  templates: [{
    id: 'std', version: 1,
    groups: [
      { id: 'sel', name: '🚀 节点选择', type: 'select', members: [{ kind: 'group', groupId: 'hk' }, { kind: 'builtin', name: 'DIRECT' }] },
      { id: 'hk', name: '🇭🇰 香港', type: 'select', members: [] },
    ],
    rules: [{ id: 'r-tg', matcher: { kind: 'ruleset', id: 'tg' }, target: { kind: 'group', groupId: 'sel' } }],
    final: { kind: 'group', groupId: 'sel' },
  }],
  profiles: [PROFILE],
  tokens: [{ token: 'tk-mac', profileId: 'p1', label: 'Mac' }],
};

function setup(responses: Record<string, string | Error> = {}) {
  let t = 1_700_000_000_000;
  const now = () => t;
  const store = new Store(':memory:', { now });
  store.importSeed(SEED);
  issueProfileToken(store, { token: 'tk-mac', profileId: 'p1' });
  const calls: string[] = [];
  const bodies: Record<string, string | Error> = {
    'https://air.example.com/sub': AIRPORT,
    'https://rules.example.com/telegram.list': 'DOMAIN-SUFFIX,t.me\nIP-CIDR,91.108.4.0/22,no-resolve\n',
    ...responses,
  };
  const fetcher: UpstreamFetcher = async (url) => {
    calls.push(url);
    const b = bodies[url];
    if (b === undefined || b instanceof Error) throw b ?? new Error('HTTP 404');
    return url.includes('air') ? { status: 200, body: b, userinfo: { upload: 1, download: 2, total: 100, expire: 1800000000 } } : { status: 200, body: b };
  };
  const snapshots = new SnapshotService(store, fetcher, now);
  const renderer = new RenderService(store, snapshots, { publicUrl: 'https://sub.test/' });
  const app = createApp({ store, renderer, snapshots, now });
  return { store, app, calls, bodies, snapshots, advance: (ms: number) => { t += ms; } };
}

const get = (app: ReturnType<typeof setup>['app'], path: string, ua = 'clash.meta') => app.request(path, { headers: { 'user-agent': ua } });

describe('订阅接口', () => {
  it('主配置：mihomo YAML、响应头、按请求 token 生成 provider 与规则集地址', async () => {
    const { app } = setup();
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1', 'clash-verge/v2.2.3 Platform/macos');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('profile-update-interval')).toBe('24');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent('落地链路')}`);
    expect(res.headers.get('subscription-userinfo')).toBe('upload=1; download=2; total=100; expire=1800000000');
    const cfg = parse(await res.text()) as Record<string, any>;
    expect(cfg['mixed-port']).toBe(7890);
    expect(cfg['allow-lan']).toBe(true);
    const nodes = new URL(cfg['proxy-providers']['机场 A'].url);
    expect(nodes.pathname).toBe('/subs/nodes');
    expect(Object.fromEntries(nodes.searchParams)).toEqual({ kind: 'provider', profile: 'p1', id: 'source:air', token: 'tk-mac', platform: 'macos', target: 'mihomo', app: 'clash-verge' });
    expect(nodes.searchParams.has('version')).toBe(false);
    const rules = new URL(cfg['rule-providers'].Telegram.url);
    expect(rules.pathname).toBe('/resources/ruleset');
    expect(Object.fromEntries(rules.searchParams)).toEqual({ token: 'tk-mac', key: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(cfg.proxies[0]['dialer-proxy']).toMatch(/^__ref_air_/);
    expect(cfg.rules.at(-1)).toBe('MATCH,🚀 节点选择');
  });

  it('浏览器打开同一链接直接显示 Mihomo，保留订阅更新信息', async () => {
    const { app, store } = setup();
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('vary')).toBe('User-Agent');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(parse(await res.text())['mixed-port']).toBe(7890);
    expect(store.recentAccess('p1')[0]).toMatchObject({ client: 'mihomo?', platform: 'macos' });
  });

  it('provider 内容与规则集内容', async () => {
    const { app } = setup();
    const cfg = parse(await (await get(app, '/subs/profile?token=tk-mac&id=p1')).text()) as Record<string, any>;
    const provPath = cfg['proxy-providers']['机场 A'].url;
    const prov = await get(app, provPath);
    expect(prov.status).toBe(200);
    expect((parse(await prov.text()) as { proxies: { name: string }[] }).proxies.map((p) => p.name)).toEqual(['🇭🇰 HK-01', '🇯🇵 日本 01']);
    const rs = await get(app, cfg['rule-providers'].Telegram.url);
    expect(await rs.text()).toBe('DOMAIN-SUFFIX,t.me\nIP-CIDR,91.108.4.0/22,no-resolve\n');
    expect((await get(app, '/resources/ruleset?token=tk-mac&key=nope')).status).toBe(404);
  });

  it('无效 token 返回 404 空响应', async () => {
    const { app } = setup();
    for (const p of ['/subs/profile?token=bad&id=p1', '/subs/nodes?kind=provider&token=bad&profile=p1&id=source%3Aair', '/resources/ruleset?token=bad&key=rs_tg_domain']) {
      const res = await get(app, p);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  it('Surge 输出完整 INI 并记入访问日志', async () => {
    const { app, store } = setup();
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1', 'Surge Mac/2894');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('[Proxy Group]');
    expect(store.recentAccess('p1')[0]).toMatchObject({ client: 'surge', status: 200 });
  });

  it('第二次请求重新生成；访问日志记录来源', async () => {
    const { app, store, calls } = setup();
    await get(app, '/subs/profile?token=tk-mac&id=p1');
    await get(app, '/subs/profile?token=tk-mac&id=p1');
    expect(calls).toHaveLength(2); // 订阅源 + 规则集各拉一次
    expect(store.recentAccess('p1').map((r) => r.source)).toEqual(['fresh', 'fresh']);
  });
});

describe('失败兜底', () => {
  it('渲染出错时返回上一份成功结果', async () => {
    const { app, store } = setup();
    const ok = await (await get(app, '/subs/profile?token=tk-mac&id=p1')).text();
    store.put('profile', { ...PROFILE, overlay: { ...PROFILE.overlay, rulePatches: { 'r-tg': { target: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'air' }, match: { exact: '不存在' } } } } } } });
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ok);
    expect(store.recentAccess('p1')[0]!.source).toBe('last-good');
  });

  it('从未成功渲染过：503 与纯文本说明', async () => {
    const { app } = setup({ 'https://air.example.com/sub': new Error('connect timeout') });
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1');
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/connect timeout/);
  });

  it('上游后来失败时继续用快照，订阅照常返回', async () => {
    const { app, bodies, advance, snapshots } = setup();
    await get(app, '/subs/profile?token=tk-mac&id=p1');
    bodies['https://air.example.com/sub'] = new Error('HTTP 502');
    advance(3_601_000);
    expect((await get(app, '/subs/profile?token=tk-mac&id=p1')).status).toBe(200);
    await snapshots.settled();
    const res = await get(app, '/subs/profile?token=tk-mac&id=p1');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('机场 A');
  });
});

describe('客户端识别', () => {
  it('参数优先，其次 UA，识别不了按 mihomo', () => {
    expect(detectClient('Surge Mac/2894', { target: 'mihomo' })).toMatchObject({ client: 'mihomo', platform: 'macos', by: 'param' });
    expect(detectClient('Surge iOS/3412', {})).toMatchObject({ client: 'surge', platform: 'ios', by: 'ua' });
    expect(detectClient('ClashMetaForAndroid/2.11.5.Meta', {})).toMatchObject({ client: 'mihomo', platform: 'android', by: 'ua' });
    expect(detectClient('FlClash/v0.8.80 clash-verge Platform/android', {})).toMatchObject({ client: 'mihomo', platform: 'android' });
    expect(detectClient('curl/8.0', {})).toMatchObject({ client: 'mihomo', by: 'default' });
    expect(detectClient('clash.meta', { platform: 'windows' })).toMatchObject({ client: 'mihomo', platform: 'windows', by: 'ua' });
  });
});
