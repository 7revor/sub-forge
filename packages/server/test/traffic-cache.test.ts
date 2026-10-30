import { issueProfileToken } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { StoredRender } from '../src/render.ts';
import type { TrafficInfo } from '../src/store.ts';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});
const a = 'https://sub.example.test/a';
const b = 'https://sub.example.test/b';
function setup() {
  const traffic: Record<string, TrafficInfo | undefined> = { [a]: { download: 10, total: 1000 }, [b]: { upload: 2, download: 20, total: 2000 } };
  let failed = false;
  const h = setupApp({ fetcher: async url => {
    if (failed) throw new Error('模拟上游故障');
    return { status: 200, body: 'trojan://test@node.example.test:443#节点', ...(traffic[url] ? { userinfo: traffic[url] } : {}) };
  } });
  envs.push(h);
  h.store.put('source', { id: 's', name: '源', url: a, pipeline: [] });
  h.store.put('profile', { id: 'p', name: '测试', nodeSets: [{ ref: { type: 'source', id: 's' }, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' } });
  issueProfileToken(h.store, { token: 'token', profileId: 'p' });
  return { ...h, traffic, fail: () => { failed = true; }, refresh: async () => {
    h.advance(1000);
    await h.snapshots.refresh('source', 's', a);
  } };
}

describe('订阅流量与渲染缓存', () => {
  it('正文不变时重新生成配置，响应头、last-good 与节点资源使用新流量', async () => {
    const h = setup();
    const first = await h.app.request('/subs/profile?token=token&id=p');
    const yaml = await first.text();
    expect(first.headers.get('subscription-userinfo')).toBe('download=10; total=1000');
    h.traffic[a] = { download: 80, total: 1000, expire: 2000000000 }; await h.refresh();
    const next = await h.app.request('/subs/profile?token=token&id=p');
    expect(next.headers.get('subscription-userinfo')).toBe('download=80; total=1000; expire=2000000000');
    expect(await next.text()).toBe(yaml);
    expect(h.store.recentAccess('p')[0]?.source).toBe('fresh');
    const last = h.store.getLastGood<StoredRender>('p', 'mihomo:any')!;
    expect(last.data.userinfo).toEqual(h.traffic[a]);
    const provider = await h.app.request(parse(yaml)['proxy-providers']['源'].url);
    expect(provider.headers.get('subscription-userinfo')).toBe('download=80; total=1000; expire=2000000000');
    h.store.put('profile', { ...h.store.get('profile', 'p')!, overlay: { final: { kind: 'group', groupId: 'missing' } } });
    const fallback = await h.renderer.render('p', { client: 'mihomo' });
    expect(fallback.ok && fallback.source).toBe('last-good');
    expect(fallback.ok && fallback.render.userinfo).toEqual(h.traffic[a]);
  });

  it('上游不再提供流量时移除旧响应头', async () => {
    const h = setup(); await h.app.request('/subs/profile?token=token&id=p');
    h.traffic[a] = undefined; await h.refresh();
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBeNull();
    expect(h.store.getLastGood<StoredRender>('p', 'mihomo:any')?.data.userinfo).toBeUndefined();
  });

  it('多个单地址源汇总流量、取最早到期时间，可单独选择来源', async () => {
    const h = setup();
    h.store.put('source', { id: 's2', name: '第二个源', url: b, pipeline: [] }, h.store.getToken('token')!.userId);
    const p = h.store.get('profile', 'p')!;
    h.store.put('profile', { ...p, nodeSets: [...p.nodeSets, { ref: { type: 'source', id: 's2' }, output: 'provider' }] });
    h.traffic[a] = { download: 10, total: 1000, expire: 2000000000 };
    h.traffic[b] = { upload: 2, download: 20, total: 2000, expire: 1900000000 };
    const expected = 'upload=2; download=30; total=3000; expire=1900000000';
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBe(expected);
    h.store.put('profile', { ...h.store.get('profile', 'p')!, userinfo: { mode: 'source', sourceId: 's' } });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBe('download=10; total=1000; expire=2000000000');
    h.store.put('profile', { ...h.store.get('profile', 'p')!, userinfo: { mode: 'none' } });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBeNull();
  });

  it('同一源经组合和直接引用重复出现时只汇总一次', async () => {
    const h = setup();
    h.store.put('collection', { id: 'c', name: '组合', members: [{ ref: { type: 'source', id: 's' } }], pipeline: [] }, h.store.getToken('token')!.userId);
    const p = h.store.get('profile', 'p')!;
    h.store.put('profile', { ...p, nodeSets: [...p.nodeSets, { ref: { type: 'collection', id: 'c' }, output: 'provider' }] });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBe('download=10; total=1000');
  });

  it('每次生成时更新拉取告警计数且保留内核告警', async () => {
    const h = setup();
    const p = h.store.get('profile', 'p')!;
    h.store.put('profile', { ...p, overlay: { extraGroups: [{ group: { id: 'g', name: '空组', type: 'select', members: [] } }] } });
    await h.app.request('/subs/profile?token=token&id=p');
    h.fail(); await h.refresh();
    const result = await h.renderer.render('p', { client: 'mihomo' });
    expect(result.ok && result.source).toBe('fresh');
    expect(result.ok && result.render.warnings).toBe(2);
    expect(result.report.map(r => r.code)).toEqual(['source.fetch-failed', 'group.empty']);
    expect(result.ok && result.render.userinfo).toEqual(h.traffic[a]);
  });
});
