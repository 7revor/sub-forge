import { afterEach, expect, it } from 'vitest';
import { setupApp } from './helpers.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const run of cleanups.splice(0)) run(); });

it('反向代理终止 TLS 时接受对外地址来源的写请求，拒绝其他来源', async () => {
  const h = setupApp();
  cleanups.push(() => h.store.close());
  const admin = h.store.createUser({ username: 'admin', passwordHash: 'fixture', role: 'admin' });
  const session = h.store.createSession(admin.id, 3600_000);
  const put = (origin: string) => h.app.request('http://sub.test/api/system', { method: 'PUT', headers: { cookie: `sf_session=${session}`, origin, 'content-type': 'application/json' }, body: JSON.stringify({ resourceCacheTtlSec: 3600 }) });
  expect((await put('https://sub.test')).status).toBe(200);
  expect((await put('https://evil.test')).status).toBe(403);
});
