import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { hashPassword, verifyPassword } from '../src/crypto.ts';
import { addUser, client, setupApp } from './helpers.ts';

describe('密码', () => {
  it('scrypt 哈希可校验，同一密码两次哈希不同', async () => {
    const a = await hashPassword('correct horse');
    expect(a).not.toBe(await hashPassword('correct horse'));
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('登录与会话', () => {
  it('登录后可访问 /api/me，退出后失效；cookie 为 HttpOnly + SameSite=Lax', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'alice');
    const c = client(app);
    expect((await c.get('/api/me')).status).toBe(401);
    const login = await c.login('alice');
    expect(login.status).toBe(200);
    expect(login.json.user).toMatchObject({ username: 'alice', role: 'user' });
    expect(login.json.user).not.toHaveProperty('passwordHash');
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(login.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    expect((await c.get('/api/me')).json.user.username).toBe('alice');
    await c.post('/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('密码错误与用户不存在返回同样的错误；连续失败后锁定', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'alice');
    const c = client(app);
    const wrong = await c.login('alice', 'nope-nope');
    const missing = await c.login('nobody', 'nope-nope');
    expect([wrong.status, wrong.json.error]).toEqual([401, '用户名或密码错误']);
    expect([missing.status, missing.json.error]).toEqual([401, '用户名或密码错误']);
    for (let i = 0; i < 4; i++) await c.login('alice', 'nope-nope');
    expect((await c.login('alice')).status).toBe(429);
  });

  it('修改密码需要当前密码，并使其他会话失效', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'alice');
    const a = client(app);
    const b = client(app);
    await a.login('alice');
    await b.login('alice');
    expect((await a.post('/api/me/password', { current: 'bad', next: 'new-password-1' })).status).toBe(403);
    expect((await a.post('/api/me/password', { current: 'password-123', next: 'short' })).status).toBe(400);
    expect((await a.post('/api/me/password', { current: 'password-123', next: 'new-password-1' })).status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(200);
    expect((await b.get('/api/me')).status).toBe(401);
    expect((await client(app).login('alice', 'new-password-1')).status).toBe(200);
  });
});

describe('修改用户名与删除用户', () => {
  it('管理员可改管理员用户名，普通用户不可改名', async () => {
    const { app, store } = setupApp();
    const root = await addUser(store, 'root', 'admin');
    const other = await addUser(store, 'other', 'admin');
    const bob = await addUser(store, 'bob');
    const admin = client(app); await admin.login('root');
    const user = client(app); await user.login('bob');

    expect((await user.patch(`/api/users/${bob.id}`, { username: 'bobby' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${bob.id}`, { username: 'bobby' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${root.id}`, { username: 'x' })).status).toBe(400);
    expect((await admin.patch(`/api/users/${root.id}`, { username: 'other' })).status).toBe(409);
    expect((await admin.patch(`/api/users/${other.id}`, { username: 'other2' })).json.user.username).toBe('other2');
    expect((await admin.patch(`/api/users/${root.id}`, { username: 'root2' })).json.user.username).toBe('root2');

    expect((await admin.get('/api/me')).json.user.username).toBe('root2');
    expect((await client(app).login('root')).status).toBe(401);
    expect((await client(app).login('root2')).status).toBe(200);
  });

  it('级联删除名下全部数据，不影响其他用户', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'root', 'admin');
    const bob = await addUser(store, 'bob');
    const carol = await addUser(store, 'carol');
    const local = { name: 'L', proxies: [{ name: 'A', type: 'socks5', server: 'host.test', port: 1080 }] };
    store.put('local', { id: 'bob-l', ...local }, bob.id);
    store.put('local', { id: 'carol-l', ...local }, carol.id);
    store.put('source', { id: 'bob-s', name: 'S', url: 'https://up.test/a', pipeline: [] }, bob.id);
    store.setSourceShares('bob-s', [carol.id]);
    store.addSnapshot({ ownerKind: 'source', ownerId: 'bob-s', url: 'https://up.test/a', fetchedAt: 1, ok: true, body: 'x' });
    store.put('ruleset', { id: 'bob-r', name: 'R', sources: [] }, bob.id);
    store.db.prepare("INSERT INTO refresh_jobs VALUES ('j', ?, '{}', 1)").run(bob.id);
    store.db.prepare("INSERT INTO native_migration_backups VALUES ('local', 'bob-l', '{}', 1)").run();
    const token = store.createToken(bob.id).token;
    store.createToken(carol.id);
    store.logAccess({ token, profileId: 'p', at: 1, ua: 'u', client: 'mihomo', status: 200, ms: 1, warnings: 0, source: 'live' });
    const admin = client(app); await admin.login('root');
    const session = client(app); await session.login('bob');

    expect((await admin.get(`/api/users/deletion-impact?id=${bob.id}`)).json.counts).toEqual({ source: 1, collection: 0, local: 1, ruleset: 1, profile: 0 });
    expect((await session.del(`/api/users/${carol.id}`)).status).toBe(403);
    expect((await admin.del('/api/users/nobody')).status).toBe(404);
    expect((await admin.del(`/api/users/${bob.id}`)).status).toBe(200);

    expect(store.getUser(bob.id)).toBeUndefined();
    expect((await session.get('/api/me')).status).toBe(401);
    expect((await client(app).login('bob')).status).toBe(401);
    expect(store.getActiveToken(token)).toBeUndefined();
    const count = (sql: string, ...args: string[]) => (store.db.prepare(`SELECT COUNT(*) n FROM ${sql}`).get(...args) as { n: number }).n;
    expect(count('docs WHERE owner = ?', bob.id)).toBe(0);
    expect(count('snapshots WHERE owner_id = ?', 'bob-s')).toBe(0);
    expect(count('source_shares')).toBe(0);
    expect(count('refresh_jobs WHERE owner = ?', bob.id)).toBe(0);
    expect(count('access_log WHERE user_id = ?', bob.id)).toBe(0);
    expect(count('native_migration_backups WHERE id = ?', 'bob-l')).toBe(0);
    expect(store.get('local', 'carol-l')).toBeDefined();
    expect(store.userToken(carol.id)).toBeDefined();
    expect(store.canUseNodeSet('source', 'bob-s', carol.id)).toBe(false);
  });

  it('管理员不能删除自己；删除前列出会失效的他人引用', async () => {
    const { app, store } = setupApp();
    const root = await addUser(store, 'root', 'admin');
    const bob = await addUser(store, 'bob');
    const carol = await addUser(store, 'carol');
    store.put('source', { id: 'bob-s', name: '机场', url: 'https://up.test/a', pipeline: [] }, bob.id);
    store.setSourceShares('bob-s', [carol.id]);
    store.put('collection', { id: 'carol-c', name: 'C', members: [{ ref: { type: 'source', id: 'bob-s' } }], pipeline: [] }, carol.id);
    const admin = client(app); await admin.login('root');

    expect((await admin.del(`/api/users/${root.id}`)).status).toBe(400);
    expect(store.getUser(root.id)).toBeDefined();
    expect((await admin.get(`/api/users/deletion-impact?id=${bob.id}`)).json.affected).toEqual(['订阅源「机场」：carol 的配置引用了它']);
    expect((await admin.get('/api/users/deletion-impact?id=nobody')).status).toBe(404);
  });
});

describe('CSRF 防护', () => {
  it('跨站 Origin 与非 JSON 请求体被拒绝', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'alice');
    const c = client(app);
    expect((await c.post('/auth/login', { username: 'alice', password: 'password-123' }, { origin: 'https://evil.example.com' })).status).toBe(403);
    const form = await app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=alice&password=password-123' });
    expect(form.status).toBe(400);
    expect((await c.post('/auth/login', { username: 'alice', password: 'password-123' }, { origin: 'http://localhost' })).status).toBe(200);
  });
});

describe('用户管理（管理员）', () => {
  it('禁用用户同时阻断已有主订阅、provider 和规则集，重新启用后恢复', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'root', 'admin');
    const user = await addUser(store, 'alice');
    store.put('local', { id: 's', name: 'S', proxies: [{ name: 'A', type: 'socks5', server: 'host.test', port: 1080 }] }, user.id);
    store.put('ruleset', { id: 'rs', name: 'R', sources: [{ id: 's1', kind: 'local', format: 'classical', content: 'DOMAIN,example.test' }] }, user.id);
    store.put('profile', { id: 'p', name: 'P', nodeSets: [{ ref: { type: 'local', id: 's' }, output: 'provider' }], overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'builtin', name: 'DIRECT' } } }] }, chains: [], refPolicy: { default: 'wrap' } }, user.id);
    const token = store.createToken(user.id).token;
    const cfg = parse(await (await app.request(`/subs/profile?token=${token}&id=p`)).text());
    const paths = [`/subs/profile?token=${token}&id=p`, cfg['proxy-providers'].S.url, cfg['rule-providers'].R.url].map((url: string) => { const u = new URL(url, 'https://sub.test'); return u.pathname + u.search; });
    const admin = client(app); await admin.login('root');
    for (const path of paths) expect((await app.request(path)).status).toBe(200);
    await admin.patch(`/api/users/${user.id}`, { disabled: true });
    for (const path of paths) expect((await app.request(path)).status).toBe(404);
    await admin.patch(`/api/users/${user.id}`, { disabled: false });
    for (const path of paths) expect((await app.request(path)).status).toBe(200);
  });
  it('普通用户不能访问；管理员可创建、禁用、重置密码', async () => {
    const { app, store } = setupApp();
    await addUser(store, 'root', 'admin');
    const bob = await addUser(store, 'bob');
    const admin = client(app);
    const user = client(app);
    await admin.login('root');
    await user.login('bob');
    expect((await user.get('/api/users')).status).toBe(403);

    const created = await admin.post('/api/users', { username: 'carol', password: 'password-456' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/users', { username: 'carol', password: 'password-456' })).status).toBe(409);
    expect((await admin.post('/api/users', { username: 'x', password: 'password-456' })).status).toBe(400);
    expect((await admin.get('/api/users')).json.users.map((u: { username: string }) => u.username)).toEqual(['root', 'bob', 'carol']);

    expect((await admin.patch(`/api/users/${bob.id}`, { disabled: true })).json.user.disabled).toBe(true);
    expect((await user.get('/api/me')).status).toBe(401);
    expect((await client(app).login('bob')).status).toBe(401);

    await admin.patch(`/api/users/${bob.id}`, { disabled: false, password: 'reset-pass-1' });
    expect((await client(app).login('bob', 'reset-pass-1')).status).toBe(200);
  });

  it('管理员不能禁用自己或取消自己的管理员身份', async () => {
    const { app, store } = setupApp();
    const root = await addUser(store, 'root', 'admin');
    const admin = client(app);
    await admin.login('root');
    expect((await admin.patch(`/api/users/${root.id}`, { disabled: true })).status).toBe(400);
    expect((await admin.patch(`/api/users/${root.id}`, { role: 'user' })).status).toBe(400);
  });
});
