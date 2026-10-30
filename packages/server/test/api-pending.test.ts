import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

describe('尚未实现的接口', () => {
  it('读接口返回空数据并标记 pending，写接口返回 501', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'root', 'admin');
    const c = client(app);
    await c.login('root');
    const repos = await c.get('/api/rule-repos/search?q=telegram');
    expect(repos.status).toBe(200);
    expect(repos.json).toMatchObject({ items: [], total: 0 });
    expect(repos.json.pending).toBeUndefined();
    expect((await c.get('/api/system')).json.resourceCacheTtlSec).toBe(86400);
    expect((await c.get('/api/shares')).json.items).toEqual([]);
    expect((await c.get('/api/users/stats')).json.items).toEqual({});
    const write = await c.post('/api/shares', { kind: 'source', id: 'x', to: [] });
    expect(write.status).toBe(501);
    expect(write.json.error).toMatch(/尚未实现/);
  });

  it('管理员接口对普通用户关闭', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'alice');
    const c = client(app);
    await c.login('alice');
    expect((await c.get('/api/system')).status).toBe(403);
    expect((await c.get('/api/rule-repos')).status).toBe(200);
  });
});
