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
  const saved = (await alice.post('/api/sources', { name: '测试源', urls: [a], pipeline: [], fetch: { ua: 'saved-agent', timeoutMs: 10000, ttlSec: 86400 } })).json.item;
  await alice.post(`/api/sources/${saved.id}/refresh`);
  const preview = (source: unknown, pipeline: unknown[] = []) => alice.post(`/api/sources/${saved.id}/pipeline-preview`, { source, pipeline });
  return { ...env, alice, saved, preview };
}

describe('订阅源拉取参数草稿预览', () => {
  it('按草稿地址顺序预览，不改已保存文档和正式快照', async () => {
    const h = await scenario();
    const before = h.store.snapshotHistory('source', h.saved.id);
    const result = await h.preview({ urls: [b, a], fetch: {} }, [{ op: 'rename.affix', prefix: '草稿·' }]);
    expect(result.status).toBe(200);
    expect(result.json.nodes.map((n: { name: string }) => n.name)).toEqual(['草稿·节点 B', '草稿·节点 A']);
    expect(h.store.get('source', h.saved.id)).toEqual(h.saved);
    expect(h.store.snapshotHistory('source', h.saved.id)).toEqual(before);
  });

  it('使用草稿 UA 与超时，处理链变化复用内容，参数变化或过期后重新拉取', async () => {
    const requests: { url: string; opts: unknown }[] = [];
    const h = await scenario(async (url, opts) => { requests.push({ url, opts }); return { status: 200, body: node(opts?.ua ?? '默认 UA') }; });
    requests.length = 0;
    const source = { urls: [a], fetch: { ua: 'draft-agent', timeoutMs: 5000, ttlSec: 3600 } };
    expect((await h.preview(source)).json.nodes[0].name).toBe('draft-agent');
    expect((await h.preview(source, [{ op: 'rename.affix', prefix: '新·' }])).json.nodes[0].name).toBe('新·draft-agent');
    expect(requests).toEqual([{ url: a, opts: source.fetch }]);
    await h.preview({ ...source, fetch: { ...source.fetch, timeoutMs: 2000 } });
    expect(requests).toHaveLength(2);
    h.advance(60_001);
    await h.preview(source);
    expect(requests).toHaveLength(3);
  });

  it('清空选填参数后使用默认值，不沿用已保存参数', async () => {
    const h = await scenario(async (_url, opts) => ({ status: 200, body: node(opts?.ua ?? '默认 UA') }));
    expect((await h.preview({ urls: [a], fetch: {} })).json.nodes[0].name).toBe('默认 UA');
    expect(h.store.get('source', h.saved.id)?.fetch?.ua).toBe('saved-agent');
  });

  it('未修改拉取参数时继续使用正式成功快照', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('正式节点') }; });
    const result = await h.preview({ urls: h.saved.urls, fetch: h.saved.fetch });
    expect(result.json.nodes[0].name).toBe('正式节点');
    expect(calls).toBe(1);
  });

  it('草稿全部失败或返回空内容时报告失败，不展示旧参数的节点', async () => {
    const h = await scenario(async (url) => ({ status: 200, body: url === a ? node('旧节点') : '' }));
    const result = await h.preview({ urls: [b] });
    expect(result.json.input).toBe(0);
    expect(result.json.nodes).toEqual([]);
    expect(result.json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'source.fetch-failed', message: expect.stringContaining('空内容') }));
    expect(h.store.snapshotHistory('source', h.saved.id)).toHaveLength(1);
  });

  it('草稿部分地址失败时保留成功结果并告警', async () => {
    const h = await scenario(async (url) => { if (url === b) throw new Error('模拟连接失败'); return { status: 200, body: node('可用节点') }; });
    const result = await h.preview({ urls: [b, a] });
    expect(result.json.input).toBe(1);
    expect(result.json.report).toContainEqual(expect.objectContaining({ level: 'warn', message: '地址 1 预览拉取失败：模拟连接失败' }));
  });

  it('草稿沿用保存校验与用户隔离，非法输入不会触发拉取', async () => {
    let calls = 0;
    const h = await scenario(async () => { calls++; return { status: 200, body: node('节点') }; });
    for (const source of [null, [], { urls: [] }, { urls: ['file:///tmp/source'] }, { urls: [b], fetch: { ttlSec: 1 } }, { urls: [b], fetch: { ua: 1 } }, { urls: [b], fetch: { timeoutMs: -1 } }]) {
      expect((await h.preview(source)).status).toBe(400);
    }
    await addUser(h.store, 'bob');
    const bob = client(h.app);
    await bob.login('bob');
    expect((await bob.post(`/api/sources/${h.saved.id}/pipeline-preview`, { source: { urls: [b] } })).status).toBe(404);
    expect(calls).toBe(1);
  });
});
