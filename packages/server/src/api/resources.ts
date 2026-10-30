import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Store } from '../store.ts';
import type { ResourceService } from '../resources.ts';
import { notFound, requireAdmin, requireUser, type ApiEnv } from './common.ts';

export function resourceRoutes(store:Store,resources:ResourceService) {
  const app=new Hono<ApiEnv>();
  const kinds = {sources:'source',collections:'collection',rulesets:'ruleset',profiles:'profile'} as const;
  for (const [path,kind] of Object.entries(kinds)) {
    app.get(`/${path}/:id/cache`,requireUser,c=>{
      const id=c.req.param('id')!;const doc=store.getWithOwner(kind,id);
      if(!doc || doc.owner!==c.get('user').id)throw notFound();
      return c.json({items:resources.statuses(resources.collect(kind,id))});
    });
    app.post(`/${path}/:id/refresh-cache`,requireUser,c=>{
      const id=c.req.param('id')!;const doc=store.getWithOwner(kind,id);
      if(!doc || doc.owner!==c.get('user').id)throw notFound();
      return c.json({job:resources.startJob(c.get('user').id,kind,id)},202);
    });
  }
  app.get('/refresh-jobs/:id',requireUser,c=>{
    const job=resources.getJob(c.req.param('id'));
    if(!job || job.owner!==c.get('user').id)throw notFound();
    return c.json({job});
  });
  app.get('/system/resources',requireAdmin,c=>c.json({items:resources.statuses(resources.all())}));
  // 事件不携带文档、URL 或其他用户数据；实际读取仍经每个接口授权。
  app.get('/events',requireUser,c=>streamSSE(c,async stream=>{
    let wake:()=>void=()=>{};
    const signal=()=>wake();store.listeners.add(signal);
    let closed=false;stream.onAbort(()=>{closed=true;wake();});
    try {
      while(!closed) {
        if(store.getUser(c.get('user').id)?.disabled)break;
        await stream.writeSSE({event:'changed',data:'{}'});
        await new Promise<void>(resolve=>{const timer=setTimeout(resolve,15000);wake=()=>{clearTimeout(timer);resolve();};});
      }
    } finally {store.listeners.delete(signal);}
  }));
  return app;
}
