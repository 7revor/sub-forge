// 管理接口共用：会话、权限、CSRF 防护、错误格式。

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Store, User } from '../store.ts';

export type ApiEnv = { Variables: { user: User } };

export const SESSION_COOKIE = 'sf_session';
export const SESSION_TTL_MS = 30 * 86400_000;

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 501 | 502, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const bad = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (what = '资源') => new HttpError(404, `${what}不存在`);

/** 当前访问地址，用于生成链接。外部入口声明 HTTPS 时链接也用 https；请求头只影响本次响应。 */
export function requestOrigin(c: Context<any, any, any>): string {
  const url = new URL(c.req.url);
  return `${c.req.header('x-forwarded-proto') === 'https' ? 'https:' : url.protocol}//${url.host}`;
}

/**
 * 写操作的 CSRF 防护：会话 cookie 为 SameSite=Lax，另外要求 JSON 请求体，
 * 且带 Origin 时主机必须与请求一致（浏览器跨站提交表单无法满足这两点）。
 * 不比较协议：HTTPS 在外部入口终止时，服务只看到 http。
 */
export function csrfGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
    const origin = c.req.header('origin');
    if (origin) {
      if (!URL.canParse(origin) || new URL(origin).host !== new URL(c.req.url).host) throw new HttpError(403, '跨站请求被拒绝');
    }
    const hasBody = (c.req.header('content-length') ?? '0') !== '0' || c.req.header('transfer-encoding');
    if (hasBody && !(c.req.header('content-type') ?? '').startsWith('application/json')) throw new HttpError(400, '请求体必须是 JSON');
    return next();
  };
}

export function sessionLoader(store: Store): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const sid = getCookie(c, SESSION_COOKIE);
    const user = sid ? store.getSessionUser(sid) : undefined;
    if (user) c.set('user', user);
    return next();
  };
}

export const requireUser: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!c.get('user')) throw new HttpError(401, '未登录');
  return next();
};

export const requireAdmin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const u = c.get('user');
  if (!u) throw new HttpError(401, '未登录');
  if (u.role !== 'admin') throw new HttpError(403, '需要管理员权限');
  return next();
};

export async function jsonBody<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('请求体必须是 JSON 对象');
    return body as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw bad('请求体不是合法的 JSON');
  }
}

export const isStr = (v: unknown, min = 1): v is string => typeof v === 'string' && v.trim().length >= min;
