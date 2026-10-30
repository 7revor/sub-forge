// 资源缓存设置持久化；仅管理员可读取和修改。
import { Hono } from 'hono';
import type { Store } from '../store.ts';
import { bad, jsonBody, requireAdmin, type ApiEnv } from './common.ts';
export function systemRoutes(store: Store) {
  const app = new Hono<ApiEnv>();
  app.get('/system', requireAdmin, c => c.json({ resourceCacheTtlSec: store.resourceCacheTtlSec }));
  app.put('/system', requireAdmin, async c => {
    const body = await jsonBody(c);
    const value = body.resourceCacheTtlSec;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 3600 || value > 8760 * 3600 || value % 3600) throw bad('资源缓存时间必须为 1 至 8760 的整数小时');
    store.setResourceCacheTtlSec(value);
    return c.json({ resourceCacheTtlSec: value });
  });
  return app;
}
