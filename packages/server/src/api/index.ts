// 管理接口入口：/api/*。所有接口都返回 JSON；错误格式为 { error, details? }。

import { Hono } from 'hono';
import type { RenderService } from '../render.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { Store } from '../store.ts';
import { authRoutes } from './auth.ts';
import { docRoutes } from './docs.ts';
import { profileRoutes } from './profiles.ts';
import { templateRoutes } from './templates.ts';
import { csrfGuard, HttpError, sessionLoader, type ApiEnv } from './common.ts';

export type ApiDeps = {
  store: Store;
  renderer: RenderService;
  snapshots: SnapshotService;
  now: () => number;
  /** PUBLIC_URL 为 https 时启用 Secure cookie */
  secureCookies: boolean;
  /** 对外地址，用于返回完整的订阅链接 */
  publicUrl: string;
  /** 允许的跨源 Origin（前端开发服务器等），默认只允许同源 */
  allowedOrigins: string[];
};

export function createApi(deps: ApiDeps) {
  const api = new Hono<ApiEnv>();
  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json(err.details === undefined ? { error: err.message } : { error: err.message, details: err.details }, err.status);
    console.error(err);
    return c.json({ error: '服务器内部错误' }, 500);
  });
  api.use('*', csrfGuard(() => deps.allowedOrigins));
  api.use('*', sessionLoader(deps.store));
  api.route('/', authRoutes(deps.store, { secureCookies: deps.secureCookies, now: deps.now }));
  api.route('/', templateRoutes(deps.store, deps.renderer));
  api.route('/', profileRoutes(deps.store, deps.renderer, deps.publicUrl));
  api.route('/', docRoutes(deps.store));
  return api;
}
