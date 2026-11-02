import { afterEach, expect, it } from 'vitest';
import { setupApp } from './helpers.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const run of cleanups.splice(0)) run(); });

it('公共规则资源接口分页，只有管理员可访问', async () => {
  const h = setupApp();
  cleanups.push(() => h.store.close());
  const admin = h.store.createUser({ username: 'admin', passwordHash: 'fixture', role: 'admin' });
  const user = h.store.createUser({ username: 'user', passwordHash: 'fixture', role: 'user' });
  for (let i = 0; i < 25; i++) h.store.putSharedRule(`key-${String(i).padStart(2, '0')}`, 'rs', { name: `规则 ${i}`, target: { client: 'mihomo' }, reference: { matcher: { kind: 'ruleset', id: 'rs' } } });
  const get = (session: string, query = '') => h.app.request(`/api/system/rule-resources${query}`, { headers: { cookie: `sf_session=${session}` } });
  const session = h.store.createSession(admin.id, 3600_000);
  const first = await (await get(session)).json() as { items: unknown[] };
  expect(first).toMatchObject({ total: 25, page: 1, pageSize: 20, totalPages: 2 });
  expect(first.items).toHaveLength(20);
  expect(first.items[0]).toMatchObject({ key: 'key-00', name: '规则 0', referenced: false });
  const second = await (await get(session, '?page=2&pageSize=10')).json() as { items: { key: string }[] };
  expect(second.items[0]?.key).toBe('key-10');
  const beyond = await (await get(session, '?page=9&pageSize=10')).json() as { items: unknown[] };
  expect(beyond).toMatchObject({ page: 3 });
  expect(beyond.items).toHaveLength(5);
  expect((await get(session, '?pageSize=0')).status).toBe(400);
  expect((await get(h.store.createSession(user.id, 3600_000))).status).toBe(403);
});
