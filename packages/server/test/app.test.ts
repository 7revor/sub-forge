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

const PROFILE: ProfileDoc = {
  id: 'p1', name: '落地链路',
  template: { id: 'std', follow: 'latest' },
  base: { presetId: 'fakeip', patch: { 'allow-lan': true } },
  nodeSets: [{ ref: { type: 'source', id: 'air' }, output: 'provider' }, { ref: { type: 'local', id: 'self' }, output: 'inline' }],
  overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'air' } }], set: { filter: 'HK' } } } },
  chains: [],
  refPolicy: { default: 'wrap' },
};

const SEED: Seed = {
  sources: [{ id: 'air', name: '机场 A', urls: ['https://air.example.com/sub'], pipeline: [{ op: 'filter.useless' }, { op: 'rename.regex', rules: [{ pattern: '^香港\\s*(\\d+)', replace: 'HK-$1' }] }, { op: 'flag', mode: 'add' }] }],
  locals: [{ id: 'self', name: '自建', proxies: [{ name: '自建 SG', type: 'trojan', server: 'sg.example.com', port: 443, password: 's', dialer: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'air' }, match: { exact: '🇭🇰 HK-01' } } } }] }],
  rulesets: [{ id: 'tg', name: 'Telegram', kind: 'remote', format: 'auto', url: 'https://rules.example.com/telegram.list' }],
  presets: [{ id: 'fakeip', name: 'fake-ip 推荐', version: 1, mihomo: { 'mixed-port': 7890, dns: { enable: true, 'enhanced-mode': 'fake-ip' } } }],
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
  tokens: [{ token: 'tk-mac', profileId: 'p1', label: 'Mac' }, { token: 'tk-phone', profileId: 'p1', label: '手机' }],
};

function setup(responses: Record<string, string | Error> = {}) {
  let t = 1_700_000_000_000;
  const now = () => t;
  const store = new Store(':memory:', { now });
  store.importSeed(SEED);
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
    const res = await get(app, '/sub/tk-mac', 'clash-verge/v2.2.3 Platform/macos');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/yaml/);
    expect(res.headers.get('profile-update-interval')).toBe('24');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('落地链路')}`);
    expect(res.headers.get('subscription-userinfo')).toBe('upload=1; download=2; total=100; expire=1800000000');
    const cfg = parse(await res.text()) as Record<string, any>;
    expect(cfg['mixed-port']).toBe(7890);
    expect(cfg['allow-lan']).toBe(true);
    expect(cfg['proxy-providers']['机场 A'].url).toMatch(/^https:\/\/sub\.test\/p\/tk-mac\/source%3Aair\?v=[0-9a-f]{32}&h=[0-9a-f]{8}&platform=macos$/);
    expect(cfg['rule-providers'].rs_tg_domain.url).toMatch(/^https:\/\/sub\.test\/r\/tk-mac\/rs_tg_domain\?v=[0-9a-f]{32}&platform=macos$/);
    expect(cfg.proxies[0]['dialer-proxy']).toMatch(/^__ref_air_/);
    expect(cfg.rules.at(-1)).toBe('MATCH,🚀 节点选择');
  });

  it('另一个设备的 token 拿到的地址指向它自己', async () => {
    const { app } = setup();
    const text = await (await get(app, '/sub/tk-phone')).text();
    expect(text).toContain('/p/tk-phone/');
    expect(text).not.toContain('tk-mac');
  });

  it('provider 内容与规则集内容', async () => {
    const { app } = setup();
    const cfg = parse(await (await get(app, '/sub/tk-mac')).text()) as Record<string, any>;
    const provPath = new URL(cfg['proxy-providers']['机场 A'].url).pathname;
    const prov = await get(app, provPath);
    expect(prov.status).toBe(200);
    expect((parse(await prov.text()) as { proxies: { name: string }[] }).proxies.map((p) => p.name)).toEqual(['🇭🇰 HK-01', '🇯🇵 日本 01']);
    const rs = await get(app, '/r/tk-mac/rs_tg_ipcidr');
    expect(await rs.text()).toBe('91.108.4.0/22\n');
    expect((await get(app, '/r/tk-mac/nope')).status).toBe(404);
  });

  it('无效 token 返回 404 空响应', async () => {
    const { app } = setup();
    for (const p of ['/sub/bad', '/p/bad/source%3Aair', '/r/bad/rs_tg_domain']) {
      const res = await get(app, p);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  it('Surge 暂未支持，返回 501 并记入访问日志', async () => {
    const { app, store } = setup();
    expect((await get(app, '/sub/tk-mac', 'Surge Mac/2894')).status).toBe(501);
    expect(store.recentAccess('p1')[0]).toMatchObject({ client: 'surge', status: 501 });
  });

  it('第二次请求命中缓存；访问日志记录来源', async () => {
    const { app, store, calls } = setup();
    await get(app, '/sub/tk-mac');
    await get(app, '/sub/tk-mac');
    expect(calls).toHaveLength(2); // 订阅源 + 规则集各拉一次
    expect(store.recentAccess('p1').map((r) => r.source)).toEqual(['cache', 'fresh']);
  });
});

describe('失败兜底', () => {
  it('渲染出错时返回上一份成功结果', async () => {
    const { app, store } = setup();
    const ok = await (await get(app, '/sub/tk-mac')).text();
    store.put('profile', { ...PROFILE, overlay: { ...PROFILE.overlay, rulePatches: { 'r-tg': { target: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'air' }, match: { exact: '不存在' } } } } } } });
    const res = await get(app, '/sub/tk-mac');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ok);
    expect(store.recentAccess('p1')[0]!.source).toBe('last-good');
  });

  it('从未成功渲染过：503 与纯文本说明', async () => {
    const { app } = setup({ 'https://air.example.com/sub': new Error('connect timeout') });
    const res = await get(app, '/sub/tk-mac');
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/connect timeout/);
  });

  it('上游后来失败时继续用快照，订阅照常返回', async () => {
    const { app, bodies, advance, snapshots } = setup();
    await get(app, '/sub/tk-mac');
    bodies['https://air.example.com/sub'] = new Error('HTTP 502');
    advance(3_601_000);
    expect((await get(app, '/sub/tk-mac')).status).toBe(200);
    await snapshots.settled();
    const res = await get(app, '/sub/tk-mac');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('机场 A');
  });
});

describe('客户端识别', () => {
  it('参数优先，其次 UA，识别不了按 mihomo', () => {
    expect(detectClient('Surge Mac/2894', { target: 'mihomo' })).toEqual({ client: 'mihomo', platform: 'macos', by: 'param' });
    expect(detectClient('Surge iOS/3412', {})).toEqual({ client: 'surge', platform: 'ios', by: 'ua' });
    expect(detectClient('ClashMetaForAndroid/2.11.5.Meta', {})).toEqual({ client: 'mihomo', platform: 'android', by: 'ua' });
    expect(detectClient('FlClash/v0.8.80 clash-verge Platform/android', {})).toMatchObject({ client: 'mihomo', platform: 'android' });
    expect(detectClient('curl/8.0', {})).toEqual({ client: 'mihomo', by: 'default' });
    expect(detectClient('clash.meta', { platform: 'windows' })).toEqual({ client: 'mihomo', platform: 'windows', by: 'ua' });
  });
});
