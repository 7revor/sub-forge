import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { addUser, client, setupApp } from './helpers.ts';
import type { NodeProbe } from '../src/node-probe.ts';

const node = { name: '草稿', type: 'http', server: 'example.com', port: 443 };
const requestId = 'test-request-123456';
const stores: ReturnType<typeof setupApp>['store'][] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
async function setup(probe?: NodeProbe) {
  const env = setupApp(); stores.push(env.store);
  const app = createApp({ ...env, nodeProbe: probe });
  await addUser(env.store, 'alice');
  const user = client(app); await user.login('alice');
  return { ...env, app, user };
}
describe('草稿连通性接口', () => {
  it('需要登录、同源请求，缺少内核返回服务未配置', async () => {
    const { user, app } = await setup();
    expect((await client(app).get('/api/node-probe')).status).toBe(401);
    expect((await client(app).post('/api/node-probe', { node, requestId })).status).toBe(401);
    expect((await user.post('/api/node-probe', { node, requestId }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await user.get('/api/node-probe')).json).toEqual({ available: false });
    expect((await user.post('/api/node-probe', { node, requestId })).json).toMatchObject({ status: 'unavailable' });
  });
  it('校验当前草稿；测试不持久化节点、凭据或结果', async () => {
    const run = vi.fn(async (_node: unknown, _signal: AbortSignal) => ({ ok: true, status: 'success' as const, message: '连接成功', delay: 13, testedAt: 1, target: 'https://test.example' }));
    const { user, store } = await setup({ available: async () => true, run, close: async () => {} });
    const put = vi.spyOn(store, 'put');
    for (const invalid of [{ ...node, port: 0 }, { ...node, type: 'ss' }, undefined]) expect((await user.post('/api/node-probe', { node: invalid, requestId })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect((await user.post('/api/node-probe', { node, requestId })).json).toMatchObject({ ok: true, delay: 13 });
    expect(run.mock.calls[0]?.[0]).toEqual(node);
    expect(put).not.toHaveBeenCalled();
  });
  it('同一用户不能并发；只有发起者可以取消，结束后释放配额', async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const { user, app, store } = await setup({ available: async () => true, close: async () => {}, run: async (_node, input) => {
      signal = input; started();
      await new Promise<void>(resolve => input.addEventListener('abort', () => resolve(), { once: true }));
      return { ok: false, status: 'cancelled', message: '测试已取消', testedAt: 1, target: '' };
    } });
    const pending = user.post('/api/node-probe', { node, requestId });
    await ready;
    expect((await user.post('/api/node-probe', { node, requestId: requestId + '2' })).status).toBe(429);
    await addUser(store, 'bob'); const bob = client(app); await bob.login('bob');
    await bob.del(`/api/node-probe/${requestId}`);
    expect(signal?.aborted).toBe(false);
    await user.del(`/api/node-probe/${requestId}`);
    expect((await pending).json).toMatchObject({ status: 'cancelled' });
  });
});
