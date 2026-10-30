import { issueProfileToken } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});
const good = 'https://upstream.example.test/good';
const bad = 'https://upstream.example.test/bad';
const node = 'trojan://test@node.example.test:443#可用节点';
function setup(url: string) {
  const responses: Record<string, string | Error> = { [good]: node, [bad]: new Error('模拟连接失败') };
  const h = setupApp({ fetcher: async url => {
    const body = responses[url];
    if (body === undefined || body instanceof Error) throw body ?? new Error('未配置测试响应');
    return { status: 200, body };
  } });
  envs.push(h);
  h.store.put('source', { id: 's', name: '单地址源', url, pipeline: [] });
  h.store.put('profile', { id: 'p', name: '测试订阅', nodeSets: [{ ref: { type: 'source', id: 's' }, output: 'inline' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' } });
  issueProfileToken(h.store, { token: 'token', profileId: 'p' });
  return { ...h, responses };
}

describe('单地址订阅源的失败回退', () => {
  it('单个 URL 从未成功时返回 503', async () => {
    const h = setup(good);
    h.responses[good] = new Error('模拟失败');
    expect((await h.app.request('/sub/token/p')).status).toBe(503);
    expect(h.store.getLastGood('p', 'mihomo:any')).toBeUndefined();
  });

  it('当前拉取失败时继续输出该 URL 的成功快照', async () => {
    const h = setup(good);
    expect((await h.app.request('/sub/token/p')).status).toBe(200);
    h.responses[good] = new Error('已用地址也不可用'); h.advance(1000);
    await h.snapshots.refresh('source', 's', good);
    const res = await h.renderer.render('p', { client: 'mihomo' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.message);
    expect(parse(res.render.yaml).proxies).toHaveLength(1);
    expect(res.report.filter(r => r.code === 'source.fetch-failed')).toHaveLength(1);
    expect(res.report.some(r => r.level === 'error')).toBe(false);
  });

  it('先有成功结果，后来换成完全不可用的地址时返回上一份成功配置', async () => {
    const h = setup(good);
    const before = await (await h.app.request('/sub/token/p')).text();
    h.store.put('source', { ...h.store.get('source', 's')!, url: bad });
    const res = await h.renderer.render('p', { client: 'mihomo' });
    expect(res.ok && res.source).toBe('last-good');
    expect(res.ok && res.render.yaml).toBe(before);
  });

  it('组合的某个成员整体不可用时仍失败，不新增成员跳过策略', async () => {
    const h = setup(good);
    h.store.put('source', { id: 'failed', name: '失败成员', url: bad, pipeline: [] });
    h.store.put('collection', { id: 'c', name: '组合', members: [{ ref: { type: 'source', id: 's' } }, { ref: { type: 'source', id: 'failed' } }], pipeline: [] });
    h.store.put('profile', { ...h.store.get('profile', 'p')!, nodeSets: [{ ref: { type: 'collection', id: 'c' }, output: 'inline' }] });
    expect((await h.app.request('/sub/token/p')).status).toBe(503);
  });
});
