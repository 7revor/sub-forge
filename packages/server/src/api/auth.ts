// 登录与用户管理（SYS-01）：管理员创建用户、重置密码、禁用；用户之间数据隔离。

import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../crypto.ts';
import type { Role, Store, User } from '../store.ts';
import { bad, HttpError, isStr, jsonBody, requireAdmin, requireUser, SESSION_COOKIE, SESSION_TTL_MS, type ApiEnv } from './common.ts';

const MIN_PASSWORD = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const ROLES: Role[] = ['admin', 'user'];

function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw bad(`密码至少 ${MIN_PASSWORD} 位`);
  return p;
}

export function authRoutes(store: Store, opts: { secureCookies: boolean; now: () => number }) {
  const app = new Hono<ApiEnv>();
  /** 按用户名计数的登录失败次数，超过上限锁定一段时间（内存中，重启清零） */
  const failures = new Map<string, { count: number; until: number }>();
  const dummyHash = hashPassword('sub-forge-dummy-password');

  const startSession = (c: Context<ApiEnv>, user: User) => {
    const sid = store.createSession(user.id, SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'Lax', secure: opts.secureCookies, path: '/', maxAge: SESSION_TTL_MS / 1000 });
  };

  app.post('/auth/login', async (c) => {
    const { username, password } = await jsonBody<{ username?: unknown; password?: unknown }>(c);
    if (!isStr(username) || typeof password !== 'string') throw bad('需要用户名和密码');
    const f = failures.get(username);
    if (f && f.count >= MAX_FAILURES && f.until > opts.now()) throw new HttpError(429, '登录失败次数过多，请稍后再试');
    const u = store.getUserAuth(username);
    // 用户不存在时也做一次哈希比较，避免通过响应时间探测用户名
    const ok = await verifyPassword(password, u?.passwordHash ?? (await dummyHash)) && !!u;
    if (!u || !ok || u.disabled) {
      const cur = failures.get(username);
      failures.set(username, { count: (cur && cur.until > opts.now() ? cur.count : 0) + 1, until: opts.now() + LOCK_MS });
      throw new HttpError(401, '用户名或密码错误');
    }
    failures.delete(username);
    const { passwordHash: _ph, ...user } = u;
    startSession(c, user);
    return c.json({ user });
  });

  app.post('/auth/logout', (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) store.deleteSession(sid);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));

  app.get('/me/token', requireUser, c => c.json({ item: store.createToken(c.get('user').id) }));
  app.post('/me/token/reset', requireUser, async c => {
    const { token } = await jsonBody<{ token?: unknown }>(c);
    const current = store.createToken(c.get('user').id);
    if (token !== current.token) throw new HttpError(409, '访问令牌已变化，请重新加载');
    const item = store.resetToken(current.token)!;
    store.changed();
    return c.json({ item });
  });

  app.post('/me/password', requireUser, async (c) => {
    const { current, next } = await jsonBody<{ current?: unknown; next?: unknown }>(c);
    const me = c.get('user');
    const auth = store.getUserAuth(me.username)!;
    if (typeof current !== 'string' || !(await verifyPassword(current, auth.passwordHash))) throw new HttpError(403, '当前密码不正确');
    store.updateUser(me.id, { passwordHash: await hashPassword(checkPassword(next)) });
    // 修改密码后其他设备的会话全部失效
    store.deleteUserSessions(me.id);
    startSession(c, me);
    return c.json({ ok: true });
  });

  // ---------- 管理员：用户管理 ----------

  app.get('/users', requireAdmin, (c) => c.json({ users: store.listUsers() }));

  app.post('/users', requireAdmin, async (c) => {
    const { username, password, role } = await jsonBody<{ username?: unknown; password?: unknown; role?: unknown }>(c);
    if (!isStr(username) || !/^[A-Za-z0-9_.-]{2,32}$/.test(username)) throw bad('用户名为 2–32 位字母、数字或 _ . -');
    if (store.getUserAuth(username)) throw new HttpError(409, '用户名已存在');
    const r = (role ?? 'user') as Role;
    if (!ROLES.includes(r)) throw bad('角色只能是 admin 或 user');
    const user = store.createUser({ username, passwordHash: await hashPassword(checkPassword(password)), role: r });
    return c.json({ user }, 201);
  });

  app.patch('/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const target = store.getUser(id);
    if (!target) throw new HttpError(404, '用户不存在');
    const body = await jsonBody<{ role?: unknown; disabled?: unknown; scriptAllowed?: unknown; password?: unknown }>(c);
    const me = c.get('user');
    if (id === me.id && (body.disabled === true || (body.role !== undefined && body.role !== 'admin'))) throw bad('不能禁用自己或取消自己的管理员身份');
    if (body.role !== undefined && !ROLES.includes(body.role as Role)) throw bad('角色只能是 admin 或 user');
    for (const k of ['disabled', 'scriptAllowed'] as const) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw bad(`${k} 必须是布尔值`);
    store.updateUser(id, {
      ...(body.role !== undefined ? { role: body.role as Role } : {}),
      ...(body.disabled !== undefined ? { disabled: body.disabled as boolean } : {}),
      ...(body.scriptAllowed !== undefined ? { scriptAllowed: body.scriptAllowed as boolean } : {}),
      ...(body.password !== undefined ? { passwordHash: await hashPassword(checkPassword(body.password)) } : {}),
    });
    if (body.disabled === true || body.password !== undefined) store.deleteUserSessions(id);
    return c.json({ user: store.getUser(id) });
  });

  return app;
}
