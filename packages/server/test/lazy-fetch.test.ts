import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { STALE_WAIT_MS } from '../src/snapshots.ts';
import { setupApp } from './helpers.ts';

const URL_A = 'https://nodes.test/a', URL_B = 'https://nodes.test/b';
const nodes = (name: string) => `proxies:\n  - { name: ${name}, type: socks5, server: a.test, port: 1080 }\n`;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('主配置不拉取规则来源，规则文件请求才拉取', async () => {
  vi.useRealTimers();
  const fetcher = vi.fn(async () => ({ status: 200, body: 'DOMAIN,lazy.test' }));
  const h = setupApp({ fetcher });
  const user = h.store.createUser({ username: 'a', passwordHash: 'x', role: 'user' }), token = h.store.userToken(user.id)!.token;
  h.store.put('ruleset', { id: 'r', name: '规则', sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/a', format: 'auto' }] }, user.id);
  h.store.put('profile', { id: 'p', name: 'p', nodeSets: [], chains: [], routing: { mode: 'independent', config: { groups: [], rules: [{ id: 'x', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' } } } }, user.id);
  const main = await h.app.request(`/subs/profile?id=p&token=${token}`);
  expect(main.status).toBe(200); expect(fetcher).not.toHaveBeenCalled();
  const url = Object.values<{ url: string }>(parse(await main.text())['rule-providers'])[0]!.url;
  expect(await (await h.app.request(url)).text()).toBe('DOMAIN,lazy.test\n');
  expect(fetcher).toHaveBeenCalledTimes(1);
  h.store.close();
});

it('内容过期时最多等待限定时间，超时先返回旧内容，刷新在后台完成', async () => {
  let body = nodes('旧'), hold: Promise<void> | undefined;
  const h = setupApp({ fetcher: async () => { if (hold) await hold; return { status: 200, body }; } });
  h.store.put('source', { id: 's', name: '源', url: URL_A, pipeline: [] }, 'u');
  await h.snapshots.get('source', 's', URL_A);
  h.advance(86400_001); body = nodes('新');
  let release!: () => void; hold = new Promise(resolve => { release = resolve; });
  const pending = h.snapshots.get('source', 's', URL_A);
  await vi.advanceTimersByTimeAsync(STALE_WAIT_MS);
  const result = await pending;
  expect(result).toMatchObject({ stale: true }); expect(result.snapshot?.body).toContain('旧'); expect(result.error).toContain('后台更新');
  release(); await h.snapshots.settled();
  expect(h.store.latestSnapshot('source', h.snapshots.resourceId('source', 's', URL_A), URL_A)?.body).toContain('新');
  h.store.close();
});

it('内容过期但上游及时响应时返回新内容', async () => {
  let body = nodes('旧');
  const h = setupApp({ fetcher: async () => ({ status: 200, body }) });
  h.store.put('source', { id: 's', name: '源', url: URL_A, pipeline: [] }, 'u');
  await h.snapshots.get('source', 's', URL_A);
  h.advance(86400_001); body = nodes('新');
  const result = await h.snapshots.get('source', 's', URL_A);
  expect(result).toMatchObject({ stale: false }); expect(result.snapshot?.body).toContain('新');
  h.store.close();
});

it('从未拉取成功时等到上游结束，不提前返回', async () => {
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const h = setupApp({ fetcher: async () => { await hold; return { status: 200, body: nodes('首次') }; } });
  h.store.put('source', { id: 's', name: '源', url: URL_A, pipeline: [] }, 'u');
  let done = false; const pending = h.snapshots.get('source', 's', URL_A).then(r => { done = true; return r; });
  await vi.advanceTimersByTimeAsync(STALE_WAIT_MS * 2);
  expect(done).toBe(false);
  release(); expect((await pending).snapshot?.body).toContain('首次');
  h.store.close();
});

it('多个节点来源并行拉取', async () => {
  vi.useRealTimers();
  let active = 0, peak = 0;
  const h = setupApp({ fetcher: async () => { peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { status: 200, body: nodes('甲') }; } });
  for (const [id, url] of [['a', URL_A], ['b', URL_B]] as const) h.store.put('source', { id, name: id, url, pipeline: [] }, 'u');
  await h.renderer.loadNodeSets([{ type: 'source', id: 'a' }, { type: 'source', id: 'b' }], 'u');
  expect(peak).toBe(2);
  h.store.close();
});

it('检查快照状态时不读取正文', async () => {
  vi.useRealTimers();
  const h = setupApp({ fetcher: async () => ({ status: 200, body: nodes('甲') }) });
  h.store.put('source', { id: 's', name: '源', url: URL_A, pipeline: [] }, 'u');
  await h.snapshots.get('source', 's', URL_A);
  const read = vi.spyOn(h.store, 'latestSnapshot');
  h.snapshots.status('source', 's', URL_A);
  expect(read).not.toHaveBeenCalled();
  h.store.close();
});
