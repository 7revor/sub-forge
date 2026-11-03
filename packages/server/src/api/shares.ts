// 节点订阅分享（SYS-06）：管理员把自己的订阅源分享给指定用户，接收者只读可引用。
//   GET /api/shares          当前管理员已分享的订阅源
//   PUT /api/shares/:id      整体设置接收者，{ to: [] } 即取消分享

import { Hono } from 'hono';
import type { Store } from '../store.ts';
import { bad, jsonBody, notFound, requireAdmin, type ApiEnv } from './common.ts';

export function shareRoutes(store: Store) {
  const app = new Hono<ApiEnv>();
  app.use('/shares', requireAdmin);
  app.use('/shares/*', requireAdmin);

  app.get('/shares', (c) => c.json({ items: store.listSourceShares(c.get('user').id) }));

  app.put('/shares/:id', async (c) => {
    const me = c.get('user'), id = c.req.param('id');
    if (store.getWithOwner('source', id)?.owner !== me.id) throw notFound('订阅源');
    const { to } = await jsonBody<{ to?: unknown }>(c);
    if (!Array.isArray(to) || to.some(user => typeof user !== 'string')) throw bad('to 必须是用户 ID 列表');
    const users = [...new Set(to as string[])];
    if (users.includes(me.id)) throw bad('不能分享给自己');
    for (const user of users) if (!store.getUser(user)) throw bad(`用户 ${user} 不存在`);
    store.setSourceShares(id, users);
    return c.json({ item: { id, name: store.get('source', id)!.name, to: users } });
  });

  return app;
}
