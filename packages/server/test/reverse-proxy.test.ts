import { afterEach, expect, it } from 'vitest';
import { setupApp } from './helpers.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const run of cleanups.splice(0)) run(); });

function writer(allowedOrigins?: string[]) {
  const h = setupApp(allowedOrigins ? { allowedOrigins } : {});
  cleanups.push(() => h.store.close());
  const admin = h.store.createUser({ username: 'admin', passwordHash: 'fixture', role: 'admin' });
  const session = h.store.createSession(admin.id, 3600_000);
  return (origin: string) => h.app.request('http://sub.test/api/system', { method: 'PUT', headers: { cookie: `sf_session=${session}`, origin, 'content-type': 'application/json' }, body: JSON.stringify({ resourceCacheTtlSec: 3600 }) });
}

it('反向代理终止 TLS 时不自动信任 PUBLIC_URL 的来源', async () => {
  expect((await writer()('https://sub.test')).status).toBe(403);
});

it('只接受 ALLOWED_ORIGINS 中配置的来源', async () => {
  const put = writer(['https://sub.test']);
  expect((await put('https://sub.test')).status).toBe(200);
  expect((await put('https://evil.test')).status).toBe(403);
});
