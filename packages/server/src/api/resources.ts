import { requiredQuery } from '../query.ts';
import type { SharedRuleRecord } from '../shared-rules.ts';
import { findReferrers } from './validate.ts';
import { HttpError } from './common.ts';
import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RuleRepoService } from '../rule-repos/service.ts';
import type { Store } from '../store.ts';
import type { ResourceService } from '../resources.ts';
import { SESSION_COOKIE, notFound, requireAdmin, requireUser, type ApiEnv } from './common.ts';

export function resourceRoutes(store:Store,resources:ResourceService,repos:RuleRepoService) {
  const app=new Hono<ApiEnv>();
  const kinds = {sources:'source',collections:'collection',rulesets:'ruleset',profiles:'profile'} as const;
  for (const [path,kind] of Object.entries(kinds)) {
    app.get(`/${path}/cache`,requireUser,c=>{
      const id=requiredQuery(c, 'id')!;const doc=store.getWithOwner(kind,id);
      if(!doc || kind !== 'ruleset' && doc.owner!==c.get('user').id)throw notFound();
      return c.json({items:resources.statuses(resources.collect(kind,id))});
    });
    app.post(`/${path}/:id/refresh-cache`,requireUser,c=>{
      const id=c.req.param('id')!;const doc=store.getWithOwner(kind,id);
      if(!doc || kind !== 'ruleset' && doc.owner!==c.get('user').id)throw notFound();
      return c.json({job:resources.startJob(c.get('user').id,kind,id)},202);
    });
  }
  app.get('/refresh-jobs',requireUser,c=>{
    const job=resources.getJob(requiredQuery(c, 'id'));
    if(!job || job.owner!==c.get('user').id)throw notFound();
    return c.json({job});
  });
  app.get('/system/resources',requireAdmin,c=>c.json({items:[...resources.statuses(resources.all()),...repos.list().filter(r=>r.enabled).map(r=>({name:`规则仓库索引 / ${r.name}`,lastSuccessAt:r.builtAt,lastAttemptAt:r.checkedAt,nextFetchAt:r.checkedAt ? r.checkedAt+store.resourceCacheTtlSec*1000 : undefined,refreshing:r.indexing,error:r.error,available:!!r.builtAt}))]}));
  app.get('/system/rule-resources', requireAdmin, c => c.json({ items: store.listSharedRules<SharedRuleRecord>().map(r => ({
    key: r.key, rulesetId: r.rulesetId, name: r.data.name, target: r.data.target, updatedAt: r.updatedAt, error: r.data.error, referenced: findReferrers(store, c.get('user').id, 'ruleset', r.rulesetId).length > 0,
  })) }));
  app.delete('/system/rule-resources/:key', requireAdmin, c => {
    const key = c.req.param('key');
    const record = store.getSharedRule<SharedRuleRecord>(key);
    if (!record) throw notFound();
    if (findReferrers(store, c.get('user').id, 'ruleset', record.reference.matcher.id).length) throw new HttpError(409, '公共规则资源仍被配置或模板引用');
    store.deleteSharedRule(key); store.changed();
    return c.json({ ok: true });
  });
  // 事件不携带文档、URL 或其他用户数据；实际读取仍经每个接口授权。
  app.get('/events',requireUser,c=>streamSSE(c,async stream=>{
    let wake:()=>void=()=>{};
    let revision=0;
    const signal=()=>{revision++;wake();};store.listeners.add(signal);
    let closed=false;stream.onAbort(()=>{closed=true;wake();});
    try {
      while(!closed && !store.eventsClosed) {
        if(!store.getSessionUser(getCookie(c,SESSION_COOKIE)??''))break;
        const sentRevision=revision;
        await stream.writeSSE({event:'changed',data:'{}'});
        if(closed || store.eventsClosed)break;
        if(revision!==sentRevision)continue;
        await new Promise<void>(resolve=>{const timer=setTimeout(resolve,15000);wake=()=>{clearTimeout(timer);resolve();};});
      }
    } finally {wake();store.listeners.delete(signal);}
  }));
  return app;
}
