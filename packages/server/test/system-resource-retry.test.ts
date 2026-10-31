import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

describe('系统异常资源重试', () => {
  it('仅管理员能重试，资源必须来自服务器已有清单且只刷新选中项', async () => {
    const calls: string[] = [];
    const h = setupApp({ fetcher: async url => { calls.push(url); return { status: 200, body: 'proxies: []' }; } });
    try {
      const admin = await addUser(h.store, 'root', 'admin');
      await addUser(h.store, 'reader');
      for (const id of ['one', 'two']) h.store.put('source', { id, name: id, url: `https://${id}.test`, pipeline: [] }, admin.id);
      const c = client(h.app);
      expect((await c.post('/api/system/resources/unknown/refresh')).status).toBe(401);
      await c.login('reader');
      expect((await c.post('/api/system/resources/unknown/refresh')).status).toBe(403);
      await c.login('root');
      expect((await c.post('/api/system/resources/unknown/refresh', { url: 'https://arbitrary.test' })).status).toBe(404);
      const list = await c.get('/api/system/resources');
      const item = list.json.items.find((r: {name:string}) => r.name === 'one');
      const result = await c.post(`/api/system/resources/${encodeURIComponent(item.resource)}/refresh`);
      expect(result.status).toBe(202);
      expect(result.json.job.total).toBe(1);
      await expect.poll(async () => (await c.get(`/api/refresh-jobs?id=${result.json.job.id}`)).json.job.state).toBe('done');
      expect(calls).toEqual(['https://one.test']);
    } finally {
      await h.snapshots.settled();
      h.store.close();
    }
  });
});
