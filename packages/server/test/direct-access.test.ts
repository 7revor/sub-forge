import { afterEach, expect, it } from 'vitest';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(() => { for (const h of envs.splice(0)) h.store.close(); });

function setup() {
  const h = setupApp();
  envs.push(h);
  const user = h.store.createUser({ username: '管理员', passwordHash: 'fixture', role: 'admin' });
  const session = h.store.createSession(user.id, 3600000);
  h.store.put('ruleset', { id: 'r', name: '规则', sources: [{ type: 'inline', rules: ['DOMAIN,example.test'] }] } as never, user.id);
  return { ...h, cookie: `sf_session=${session}` };
}

it('订阅链接跟随当前访问地址', async () => {
  const h = setup();
  for (const base of ['http://192.0.2.10:8080', 'http://sub.test:9000']) {
    const res = await h.app.request(`${base}/api/resource-links?kind=rulesets&id=r`, { headers: { cookie: h.cookie } });
    expect((await res.json() as { item: { url: string } }).item.url.startsWith(`${base}/resources/ruleset?`)).toBe(true);
  }
});

it('写操作只接受同源请求', async () => {
  const h = setup();
  const write = (origin: string) => h.app.request('http://192.0.2.10:8080/api/auth/logout', { method: 'POST', headers: { cookie: h.cookie, origin } });
  expect((await write('http://198.51.100.1:8080')).status).toBe(403);
  expect((await write('http://192.0.2.10:8080')).status).not.toBe(403);
});
