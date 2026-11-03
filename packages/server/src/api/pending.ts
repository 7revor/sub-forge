// 前端已有界面、服务端尚未实现的接口（docs/11「后端待实现」）。
// 读接口返回空数据并带 pending: true，前端据此提示「服务端尚未实现」；写接口一律返回 501。

import { Hono } from 'hono';
import { requireAdmin, type ApiEnv } from './common.ts';

export function pendingRoutes() {
  const app = new Hono<ApiEnv>();

  // 用户列表的统计列（配置订阅数、订阅源数、最近订阅请求）
  app.get('/users/stats', requireAdmin, (c) => c.json({ pending: true, items: {} }));

  return app;
}
