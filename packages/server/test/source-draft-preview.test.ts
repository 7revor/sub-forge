import { afterEach, describe, expect, it } from 'vitest';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { addUser, client, setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});
const a = 'https://a.example.test/sub';
const b = 'https://b.example.test/sub';
const node = (name: string) => `trojan://test@node.example.test:443#${name}`;

async function scenario(fetcher: UpstreamFetcher = async (url) => ({ status: 200, body: node(url === a ? '节点 A' : '节点 B') })) {
  const env = setupApp({ fetcher });
  envs.push(env);
  await addUser(env.store, 'alice');
  const alice = client(env.app);
  await alice.login('alice');
  const saved = (await alice.post('/api/sources', { name: '测试源', url: a, pipeline: [], fetch: { ua: 'saved-agent', timeoutMs: 10000, ttlSec: 86400 } })).json.item;
  await alice.post(`/api/sources/${saved.id}/refresh`);
  const preview = (source: unknown, pipeline: unknown[] = []) => alice.post(`/api/sources/${saved.id}/pipeline-preview`, { source, pipeline });
  return { ...env, alice, saved, preview };
}

describe('订阅源拉取参数草稿预览', () => {
  it('按草稿单个地址预览，不改已保存文档和正式快照', async () => {
    const h = await scenario();
    const before = h.store.snapshotHistory('source', h.saved.id);
    const result = await h.preview({ url: b, fetch: {} }, [{ op: 'rename.affix', prefix: '草稿·' }]);
    expect(result.status).toBe(200);
    expect(result.json.nodes.map((n: { name: string }) => n.name)).toEqual(['草稿·节点 B']);
    expect(h.store.get('source', h.saved.id)).toEqual(h.saved);
    expect(h.store.snapshotHistory('source', h.saved.id)).toEqual(before);
  });

  it('草稿固定 UA 和超时，处理链与旧拉取选项变化复用内容，缓存过期后重新拉取', async () => {
    const requests: { url: string; opts: unknown }[] = [];
    const h = await scenario(async (url, opts) => { requests.push({ url, opts }); return { status: 200, body: node(opts?.ua ?? '缺少 UA') }; });
    expect(h.saved.fetch).toEqual({ ttlSec: 86400 });
    expect(requests[0]?.opts).toEqual({ ua: 'clash.meta', timeoutMs: 10000 });
    requests.length = 0;
    const source = { url: b, fetch: { ua: 'draft-agent', timeoutMs: 5000, ttlSec: 3600 } };
    expect((await h.preview(source)).json.nodes[0].name).toBe('clash.meta');
    expect((await h.preview(source, [{ op: 'rename.affix', prefix: '新·' }])).json.nodes[0].name).toBe('新·clash.meta');
    expect(requests).toEqual([{ url: b, opts: { ua: 'clash.meta', timeoutMs: 10000 } }]);
    await h.preview({ ...source, fetch: { ...source.fetch, timeoutMs: 2000 } });
    expect(requests).toHaveLength(1);
    h.advance(60_001);
    await h.preview(source);
    expect(requests).toHaveLength(2);
  });

  it('只改自动更新时间不会另拉草稿，也不会提前修改正式配置', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('正式节点') }; });
    expect((await h.preview({ url: a, fetch: { ttlSec: 3600 } })).json.nodes[0].name).toBe('正式节点');
    expect(calls).toBe(1);
    expect(h.store.get('source', h.saved.id)?.fetch).toEqual({ ttlSec: 86400 });
    const saved = await h.alice.put(`/api/sources/${h.saved.id}`, { ...h.saved, fetch: { ttlSec: 3600, ua: '旧 UA', timeoutMs: 1 } });
    expect(saved.json.item.fetch).toEqual({ ttlSec: 3600 });
  });

  it('未修改拉取参数时继续使用正式成功快照', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('正式节点') }; });
    const result = await h.preview({ url: h.saved.url, fetch: h.saved.fetch });
    expect(result.json.nodes[0].name).toBe('正式节点');
    expect(calls).toBe(1);
  });

  it('草稿全部失败或返回空内容时报告失败，不展示旧参数的节点', async () => {
    const h = await scenario(async (url) => ({ status: 200, body: url === a ? node('旧节点') : '' }));
    const result = await h.preview({ url: b });
    expect(result.json.input).toBe(0);
    expect(result.json.nodes).toEqual([]);
    expect(result.json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'source.fetch-failed', message: expect.stringContaining('空内容') }));
    expect(h.store.snapshotHistory('source', h.saved.id)).toHaveLength(1);
  });

  it('多地址草稿拒绝预览，不拉取任何新地址', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('原节点') }; });
    expect((await h.preview({ urls: [b, a] })).status).toBe(400);
    expect((await h.preview({ url: [a, b] })).status).toBe(400);
    expect(calls).toBe(1);
  });

  it('旧客户端单地址草稿可预览，正式文档保持 url 格式', async () => {
    const h = await scenario();
    const result = await h.preview({ urls: [b] });
    expect(result.status).toBe(200);
    expect(result.json.nodes[0].name).toBe('节点 B');
    expect(h.store.get('source', h.saved.id)).toEqual(h.saved);
    expect(h.saved).not.toHaveProperty('urls');
  });

  it('草稿沿用保存校验与用户隔离，非法输入不会触发拉取', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('节点') }; });
    for (const source of [null, [], { urls: [] }, { url: 'file:///tmp/source' }, { url: b, fetch: { ttlSec: 1 } }, { url: b, fetch: [] }]) {
      expect((await h.preview(source)).status).toBe(400);
    }
    await addUser(h.store, 'bob');
    const bob = client(h.app);
    await bob.login('bob');
    expect((await bob.post(`/api/sources/${h.saved.id}/pipeline-preview`, { source: { url: b } })).status).toBe(404);
    expect(calls).toBe(1);
  });
});
