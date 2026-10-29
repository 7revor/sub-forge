// 前端已有界面、服务端尚未实现的接口（docs/11「后端待实现」）。
// 读接口返回空数据并带 pending: true，前端据此提示「服务端尚未实现」；写接口一律返回 501。

import { Hono } from 'hono';
import { HttpError, requireAdmin, requireUser, type ApiEnv } from './common.ts';

const todo = (what: string) => () => { throw new HttpError(501, `${what}：服务端尚未实现`); };

export function pendingRoutes() {
  const app = new Hono<ApiEnv>();

  // 用户列表的统计列（配置订阅数、订阅源数、最近订阅请求）
  app.get('/users/stats', requireAdmin, (c) => c.json({ pending: true, items: {} }));

  // 订阅源与组合的共享（被共享的用户只能引用，看不到原始 URL）
  app.get('/shares', requireAdmin, (c) => c.json({ pending: true, items: [] }));
  app.post('/shares', requireAdmin, todo('共享'));
  app.delete('/shares/:id', requireAdmin, todo('共享'));

  // 自定义仓库适配器尚未实现；内置仓库由 rule-repos.ts 提供。
  app.post('/rule-repos', requireAdmin, todo('添加自定义仓库'));
  app.delete('/rule-repos/:id', requireAdmin, todo('删除自定义仓库'));

  // 系统设置：SSRF 白名单、mihomo 校验、仓库镜像、备份与恢复
  app.get('/system', requireAdmin, (c) => c.json({ pending: true, ssrfAllow: [], verify: null, mirror: '', lastBackup: null }));
  app.put('/system', requireAdmin, todo('系统设置'));
  app.post('/system/backup', requireAdmin, todo('导出备份'));
  app.post('/system/restore', requireAdmin, todo('从备份恢复'));

  return app;
}
