import { ResourceService } from '../resources.ts';
import { resourceRoutes } from './resources.ts';
import { systemRoutes } from './system.ts';
import { ruleConversionRoutes } from './rule-conversion.ts';
// 管理接口入口：/api/*。所有接口都返回 JSON；错误格式为 { error, details? }。

import { nodeProbeRoutes } from './node-probe.ts';
import type { NodeProbe } from '../node-probe.ts';
import { Hono } from 'hono';
import type { RenderService } from '../render.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { Store } from '../store.ts';
import { RuleRepoService } from '../rule-repos/service.ts';
import { parseAllowList } from '../net/ssrf.ts';
import { createUpstreamFetcher } from '../net/upstream.ts';
import { ruleRepoRoutes } from './rule-repos.ts';
import { ruleOptionRoutes } from './rule-options.ts';
import { authRoutes } from './auth.ts';
import { pendingRoutes } from './pending.ts';
import { docRoutes } from './docs.ts';
import { previewRoutes } from './preview.ts';
import { profileRoutes } from './profiles.ts';
import { templateRoutes } from './templates.ts';
import { csrfGuard, HttpError, sessionLoader, type ApiEnv } from './common.ts';

export type ApiDeps = {
  store: Store;
  resources?: ResourceService;
  nodeProbe?: NodeProbe;
  ruleRepos?: RuleRepoService;
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
  api.use('*', async (c,next)=>{c.header('cache-control','no-store');await next();if(c.res.status<400 && ['PUT','PATCH','DELETE'].includes(c.req.method))deps.store.changed();});
  api.use('*', csrfGuard(() => deps.allowedOrigins));
  api.use('*', sessionLoader(deps.store));
  // 占位接口先于 /users/:id 等通配路由注册
  const repos = deps.ruleRepos ?? new RuleRepoService(deps.store, createUpstreamFetcher({ allow: parseAllowList([]) }), deps.now,undefined,deps.snapshots);
  const resources=deps.resources ?? new ResourceService(deps.store,deps.snapshots,deps.renderer,deps.now);
  api.route('/', ruleRepoRoutes(deps.store, repos, resources));
  api.route('/', ruleOptionRoutes(deps.store, repos));

  api.route('/', resourceRoutes(deps.store,resources,repos));
  api.route('/', systemRoutes(deps.store));
  api.route('/', pendingRoutes());
  api.route('/', nodeProbeRoutes(deps.nodeProbe));
  api.route('/', authRoutes(deps.store, { secureCookies: deps.secureCookies, now: deps.now }));
  api.route('/', templateRoutes(deps.store, deps.renderer, deps.snapshots));
  api.route('/', profileRoutes(deps.store, deps.renderer, deps.publicUrl));
  api.route('/', ruleConversionRoutes(deps.store, deps.snapshots, deps.renderer));
  api.route('/', previewRoutes(deps.store, deps.renderer, deps.snapshots));
  api.route('/', docRoutes(deps.store));
  return api;
}
