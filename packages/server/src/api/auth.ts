// 登录与用户管理（SYS-01）：管理员创建用户、重置密码、禁用、修改管理员用户名、删除用户；用户之间数据隔离。

import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../crypto.ts';
import { requiredQuery } from '../query.ts';
import { OWNED_KINDS, type Role, type Store, type User } from '../store.ts';
import { bad, HttpError, isStr, jsonBody, requireAdmin, requireUser, SESSION_COOKIE, SESSION_TTL_MS, type ApiEnv } from './common.ts';
import { findReferrers } from './validate.ts';

const MIN_PASSWORD = 8;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const ROLES: Role[] = ['admin', 'user'];

function checkPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw bad(`密码至少 ${MIN_PASSWORD} 位`);
  return p;
}

function checkUsername(u: unknown): string {
  if (!isStr(u) || !/^[A-Za-z0-9_.-]{2,32}$/.test(u)) throw bad('用户名为 2–32 位字母、数字或 _ . -');
  return u;
}

/** 删除用户前展示的影响：名下文档数量，以及会因此失效的他人配置和模板。 */
function deletionImpact(store: Store, id: string) {
  const counts = Object.fromEntries(OWNED_KINDS.map(kind => [kind, store.list(kind, id).length]));
  const affected = new Set<string>();
  for (const share of store.listSourceShares(id)) {
    for (const recipient of share.to) if (findReferrers(store, recipient, 'source', share.id).length) affected.add(`订阅源「${share.name}」：${store.getUser(recipient)?.username ?? recipient} 的配置引用了它`);
  }
  for (const ruleset of store.list('ruleset', id)) {
    for (const hit of findReferrers(store, id, 'ruleset', ruleset.id)) if (!hit.startsWith('配置订阅「')) affected.add(`规则集「${ruleset.name}」：${hit}引用了它`);
  }
  return { counts, affected: [...affected] };
}

const startSession = (c: Context<ApiEnv>, user: User, store: Store) => {
    const sid = store.createSession(user.id, SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
  };

export function sessionRoutes(store: Store, opts: { now: () => number }) {
  const app = new Hono<ApiEnv>();
  /** 按用户名计数的登录失败次数，超过上限锁定一段时间（内存中，重启清零） */
  const failures = new Map<string, { count: number; until: number }>();
  const dummyHash = hashPassword('sub-forge-dummy-password');

  app.post('/login', async (c) => {
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
    startSession(c, user, store);
    return c.json({ user });
  });

  app.post('/logout', (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) store.deleteSession(sid);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  return app;
}

export function authRoutes(store: Store, opts: { now: () => number }) {
  const app = new Hono<ApiEnv>();
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
    startSession(c, me, store);
    return c.json({ ok: true });
  });

  // ---------- 管理员：用户管理 ----------

  app.get('/users', requireAdmin, (c) => c.json({ users: store.listUsers() }));

  app.post('/users', requireAdmin, async (c) => {
    const { username, password, role, scriptAllowed } = await jsonBody<{ username?: unknown; password?: unknown; role?: unknown; scriptAllowed?: unknown }>(c);
    if (store.getUserAuth(checkUsername(username))) throw new HttpError(409, '用户名已存在');
    const r = (role ?? 'user') as Role;
    if (!ROLES.includes(r)) throw bad('角色只能是 admin 或 user');
    if (scriptAllowed !== undefined && typeof scriptAllowed !== 'boolean') throw bad('scriptAllowed 必须是布尔值');
    const user = store.createUser({ username: username as string, passwordHash: await hashPassword(checkPassword(password)), role: r, scriptAllowed: scriptAllowed === true });
    return c.json({ user }, 201);
  });

  app.patch('/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const target = store.getUser(id);
    if (!target) throw new HttpError(404, '用户不存在');
    const body = await jsonBody<{ username?: unknown; role?: unknown; disabled?: unknown; scriptAllowed?: unknown; password?: unknown }>(c);
    const me = c.get('user');
    if (id === me.id && (body.disabled === true || (body.role !== undefined && body.role !== 'admin'))) throw bad('不能禁用自己或取消自己的管理员身份');
    if (body.role !== undefined && !ROLES.includes(body.role as Role)) throw bad('角色只能是 admin 或 user');
    for (const k of ['disabled', 'scriptAllowed'] as const) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw bad(`${k} 必须是布尔值`);
    if (body.username !== undefined) {
      if (target.role !== 'admin') throw new HttpError(403, '普通用户不能修改用户名');
      const holder = store.getUserAuth(checkUsername(body.username));
      if (holder && holder.id !== id) throw new HttpError(409, '用户名已存在');
    }
    store.updateUser(id, {
      ...(body.username !== undefined ? { username: body.username as string } : {}),
      ...(body.role !== undefined ? { role: body.role as Role } : {}),
      ...(body.disabled !== undefined ? { disabled: body.disabled as boolean } : {}),
      ...(body.scriptAllowed !== undefined ? { scriptAllowed: body.scriptAllowed as boolean } : {}),
      ...(body.password !== undefined ? { passwordHash: await hashPassword(checkPassword(body.password)) } : {}),
    });
    if (body.disabled === true || body.password !== undefined) store.deleteUserSessions(id);
    return c.json({ user: store.getUser(id) });
  });

  app.get('/users/deletion-impact', requireAdmin, (c) => {
    const id = requiredQuery(c, 'id');
    if (!store.getUser(id)) throw new HttpError(404, '用户不存在');
    return c.json(deletionImpact(store, id));
  });

  app.delete('/users/:id', requireAdmin, (c) => {
    const id = c.req.param('id');
    if (id === c.get('user').id) throw bad('不能删除自己');
    if (!store.getUser(id)) throw new HttpError(404, '用户不存在');
    store.deleteUser(id);
    return c.json({ ok: true });
  });

  return app;
}
