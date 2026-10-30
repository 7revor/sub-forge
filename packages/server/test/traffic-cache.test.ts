import { issueProfileToken } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { StoredRender } from '../src/render.ts';
import type { TrafficInfo } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

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


describe('多选流量来源', () => {
  it('可选择节点输出之外的来源，只汇总所选来源且不改变节点与 Provider 流量', async () => {
    const h = setup();
    const owner = h.store.getToken('token')!.userId;
    h.store.put('source', { id: 's2', name: '第二个源', url: b, pipeline: [] }, owner);
    const first = await h.app.request('/subs/profile?token=token&id=p');
    const yaml = await first.text();
    const profile = h.store.get('profile', 'p')!;
    h.store.put('profile', { ...profile, userinfo: { mode: 'sources', sourceIds: ['s2'] } });
    const selected = await h.app.request('/subs/profile?token=token&id=p');
    expect(selected.status).toBe(200);
    expect(selected.headers.get('subscription-userinfo')).toBe('upload=2; download=20; total=2000');
    expect(await selected.text()).toBe(yaml);
    expect((await h.app.request(parse(yaml)['proxy-providers']['源'].url)).headers.get('subscription-userinfo')).toBe('download=10; total=1000');
    h.traffic[a] = { download: 10, total: 1000, expire: 2000000000 };
    h.traffic[b] = { upload: 0, download: 20, total: 2000, expire: 1900000000 };
    await h.refresh();
    await h.snapshots.refresh('source', 's2', b);
    h.store.put('profile', { ...profile, userinfo: { mode: 'sources', sourceIds: ['s', 's2'] } });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBe('upload=0; download=30; total=3000; expire=1900000000');
    h.store.put('profile', { ...profile, userinfo: { mode: 'sources', sourceIds: [] } });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBeNull();
  });

  it('重复 ID、重复上游地址只统计一次，字段缺失与零值保持原样', async () => {
    const h = setup();
    h.store.put('source', { id: 'same', name: '重复地址', url: a, pipeline: [] }, h.store.getToken('token')!.userId);
    h.traffic[a] = { upload: 0, expire: 0 };
    h.store.put('profile', { ...h.store.get('profile', 'p')!, userinfo: { mode: 'sources', sourceIds: ['s', 's', 'same'] } });
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBe('upload=0; expire=0');
    h.traffic[a] = undefined;
    await h.refresh();
    await h.snapshots.refresh('source', 'same', a);
    expect((await h.app.request('/subs/profile?token=token&id=p')).headers.get('subscription-userinfo')).toBeNull();
  });

  it('独立流量来源的权限撤销后拒绝当前渲染和旧成功结果', async () => {
    const h = setup();
    h.store.put('source', { id: 's2', name: '第二个源', url: b, pipeline: [] }, h.store.getToken('token')!.userId);
    h.store.put('profile', { ...h.store.get('profile', 'p')!, userinfo: { mode: 'sources', sourceIds: ['s2'] } });
    expect((await h.renderer.render('p', { client: 'mihomo' })).ok).toBe(true);
    const other = await addUser(h.store, 'other');
    h.store.db.prepare("UPDATE docs SET owner = ? WHERE kind = 'source' AND id = 's2'").run(other.id);
    expect(await h.renderer.render('p', { client: 'mihomo' })).toMatchObject({ ok: false, accessDenied: true });
  });

  it('接口校验多选、保存重读并防止删除仍用于流量的订阅源', async () => {
    const h = setupApp(); envs.push(h);
    const alice = await addUser(h.store, 'alice');
    const bob = await addUser(h.store, 'bob');
    h.store.put('source', { id: 'a', name: '甲', url: a, pipeline: [] }, alice.id);
    h.store.put('source', { id: 'b', name: '乙', url: b, pipeline: [] }, alice.id);
    h.store.put('source', { id: 'private', name: '他人来源', url: b, pipeline: [] }, bob.id);
    const api = client(h.app); await api.login('alice');
    const body = { name: '多选', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } };
    for (const userinfo of [null, { mode: 'invalid' }, { mode: 'sources', sourceIds: 'a' }, { mode: 'sources', sourceIds: [null] }, { mode: 'sources', sourceIds: [''] }, { mode: 'sources', sourceIds: ['missing'] }, { mode: 'sources', sourceIds: ['private'] }]) {
      expect((await api.post('/api/profiles', { ...body, userinfo })).status).toBe(400);
    }
    const created = await api.post('/api/profiles', { ...body, userinfo: { mode: 'sources', sourceIds: ['a', 'b', 'a'] } });
    expect(created.status, created.text).toBe(201);
    const profile = created.json.item;
    expect((await api.get(`/api/profiles?id=${profile.id}`)).json.item.userinfo).toEqual({ mode: 'sources', sourceIds: ['a', 'b'] });
    expect((await api.del('/api/sources/b')).status).toBe(409);
    expect((await api.put(`/api/profiles/${profile.id}`, { ...profile, userinfo: { mode: 'sources', sourceIds: [] } })).status).toBe(200);
    expect((await api.del('/api/sources/b')).status).toBe(200);
  });
});
