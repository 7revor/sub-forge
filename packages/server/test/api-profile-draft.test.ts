import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const draft = { name: '草稿', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' } };

async function scenario() {
  const env = setupApp();
  await addUser(env.store, 'alice');
  const alice = client(env.app);
  await alice.login('alice');
  return { ...env, alice };
}

describe('未保存 Profile 草稿预览', () => {
  it('能渲染 YAML 和依赖，忽略传入 id，不读写渲染缓存或持久化 Profile、last-good、访问日志', async () => {
    const { alice, store, renderer } = await scenario();
    const source = (await alice.post('/api/sources', { name: '节点', kind: 'local', content: 'trojan://pw@a.example.com:443#香港' })).json.item;
    const get = vi.spyOn(store, 'get');
    const put = vi.spyOn(store, 'put');
    const putLast = vi.spyOn(store, 'putLastGood');
    const getLast = vi.spyOn(store, 'getLastGood');
    const log = vi.spyOn(store, 'logAccess');
    const cache = Reflect.get(renderer, 'cache') as Map<string, unknown>;
    const cacheGet = vi.spyOn(cache, 'get');
    const cacheSet = vi.spyOn(cache, 'set');
    const res = await alice.post('/api/profiles/preview', {
      profile: { ...draft, id: '某个已保存文档', nodeSets: [{ ref: { type: 'source', id: source.id }, output: 'provider' }] }, platform: 'macos',
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, report: [], dependencies: [] });
    const yaml = parse(res.json.yaml);
    expect(yaml.rules).toContain('MATCH,DIRECT');
    expect(JSON.stringify(yaml['proxy-providers'])).toContain('/p/{token}/');
    expect(res.json.yaml).not.toContain('__SF_TOKEN__');
    expect(store.list('profile')).toEqual([]);
    expect(get.mock.calls.some(([kind]) => kind === 'profile')).toBe(false);
    for (const spy of [put, putLast, getLast, log, cacheGet, cacheSet]) expect(spy).not.toHaveBeenCalled();
  });

  it('引用别人的节点集时返回 400', async () => {
    const { alice, store, app } = await scenario();
    await addUser(store, 'bob');
    const bob = client(app);
    await bob.login('bob');
    const source = (await bob.post('/api/sources', { name: '私有节点', kind: 'local', content: 'trojan://secret@b.example.com:443#私有' })).json.item;
    const res = await alice.post('/api/profiles/preview', { profile: { ...draft, nodeSets: [{ ref: { type: 'source', id: source.id }, output: 'provider' }] } });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('不存在');
    expect(res.json).not.toHaveProperty('yaml');
  });

  it('未登录返回 401', async () => {
    const { app } = setupApp();
    expect((await client(app).post('/api/profiles/preview', { profile: draft })).status).toBe(401);
  });

  it('拒绝缺失或非法草稿、空名称和不支持的平台', async () => {
    const { alice } = await scenario();
    for (const body of [{}, { profile: [] }, { profile: '无效' }, { profile: { ...draft, name: '' } }, { profile: draft, platform: 'invalid' }]) {
      expect((await alice.post('/api/profiles/preview', body)).status).toBe(400);
    }
  });
});
