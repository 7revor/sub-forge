import { Hono } from 'hono';
import { ACCESS_KINDS, type AccessKind, type Store } from '../store.ts';
import { bad, requireUser, type ApiEnv } from './common.ts';
import { readPagination } from './pagination.ts';

export function accessLogRoutes(store: Store) {
  const app = new Hono<ApiEnv>();
  app.get('/access-log', requireUser, c => {
    const kind = c.req.query('kind');
    if (kind !== undefined && !ACCESS_KINDS.includes(kind as AccessKind)) throw bad('访问类型不合法');
    const page = readPagination(c.req.query()) ?? { page: 1, pageSize: 20, q: '' };
    return c.json(store.userAccessPage(c.get('user').id, page, kind as AccessKind | undefined));
  });
  return app;
}
