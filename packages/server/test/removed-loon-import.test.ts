import { expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

it('已移除的 Loon 完整导入接口不再预览或创建资源', async () => {
  let fetched = 0;
  const h = setupApp({ fetcher: async () => { fetched++; throw new Error('已移除的接口不应拉取远程内容'); } });
  try {
    const user = await addUser(h.store, 'alice');
    const api = client(h.app);
    await api.login('alice');
    const token = h.store.userToken(user.id);
    for (const save of [false, true]) {
      const result = await api.post('/api/profiles/import/loon', {
        name: '旧导入请求',
        text: '[Remote Proxy]\n远程节点 = https://example.test/sub\n[Rule]\nFINAL,DIRECT',
        save,
      });
      expect(result.status).toBe(404);
      for (const kind of ['profile', 'source', 'local', 'collection'] as const) expect(h.store.list(kind)).toEqual([]);
      expect(h.store.userToken(user.id)).toEqual(token);
    }
    expect(fetched).toBe(0);
  } finally {
    await h.snapshots.settled();
    h.store.close();
  }
});
