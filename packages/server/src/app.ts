import { accessLogger, type DownloadEnv } from './access-log.ts';
import type { BlockList } from 'node:net';
// /subs 为用户私有订阅，/resources 为公共规则；动态值只使用查询参数。
// 资源凭证与登录会话互不替代，失效或越权不暴露资源存在性。

import { resourceFileRoutes, subscriptionRuleRoutes } from './resource-files.ts';
import { sessionRoutes } from './api/auth.ts';
import { csrfGuard, HttpError, type ApiEnv } from './api/common.ts';
import { allowedQuery, requiredQuery, uniqueQuery } from './query.ts';
import { RuleRepoService } from './rule-repos/service.ts';
import { createUpstreamFetcher } from './net/upstream.ts';
import { parseAllowList } from './net/ssrf.ts';
import type { SharedRuleRecord } from './shared-rules.ts';
import { ResourceAccessError } from './resource-access.ts';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import type { Platform } from '@sub-forge/core';
import { createApi, type ApiDeps } from './api/index.ts';
import { InvalidClientTarget, detectClient } from './client.ts';
import { TOKEN_PLACEHOLDER, type RenderOutcome, type RenderService, type Target } from './render.ts';
import type { Store, TrafficInfo } from './store.ts';

const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];

function userinfoHeader(u: TrafficInfo | undefined): string | undefined {
  if (!u) return undefined;
  const parts = (['upload', 'download', 'total', 'expire'] as const).filter((k) => u[k] !== undefined).map((k) => `${k}=${u[k]}`);
  return parts.length ? parts.join('; ') : undefined;
}

const notFound = (c: Context) => c.body(null, 404);

export type AppDeps = Omit<ApiDeps, 'now' | 'secureCookies' | 'allowedOrigins' | 'publicUrl'> & Partial<Pick<ApiDeps, 'now' | 'secureCookies' | 'allowedOrigins' | 'publicUrl'>> & {
  /** 前端构建产物目录（packages/web/dist）；设置后托管静态文件，其余路径回落到 index.html */
  webDir?: string;
  trustedProxies?: BlockList;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
/** 这些前缀属于接口，不回落到前端页面 */
const RESERVED = ['/api', '/auth', '/subs', '/resources', '/sub', '/p', '/r', '/rules', '/nodes'];

/** 托管前端：/assets 下的文件名带内容哈希，可长期缓存；index.html 不缓存 */
function serveWeb(app: Hono<DownloadEnv>, webDir: string) {
  const root = resolve(webDir);
  const send = async (c: Context, file: string, immutable: boolean) => {
    const body = await readFile(file);
    c.header('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    c.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    c.header('x-content-type-options', 'nosniff');
    return c.body(body);
  };
  app.get('*', async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (RESERVED.some(p => path === p || path.startsWith(p + '/'))) return c.body(null, 404);
    const file = normalize(join(root, path));
    if (file.startsWith(root + sep) && extname(file)) {
      const st = await stat(file).catch(() => undefined);
      if (st?.isFile()) return send(c, file, path.startsWith('/assets/'));
      return c.body(null, 404);
    }
    return send(c, join(root, 'index.html'), false);
  });
}

export function createApp(deps: AppDeps) {
  const { store, renderer } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono<DownloadEnv>();
  app.use('*', accessLogger(store, now, deps.trustedProxies));

  app.get('/healthz', (c) => c.text('ok'));
  const ruleRepos = deps.ruleRepos ?? new RuleRepoService(store, createUpstreamFetcher({ allow: parseAllowList([]) }), now, undefined, deps.snapshots);
  const apiDeps = { ...deps, ruleRepos, now, secureCookies: deps.secureCookies ?? false, allowedOrigins: deps.allowedOrigins ?? [], publicUrl: deps.publicUrl ?? '' };
  app.route('/api', createApi(apiDeps));
  const auth = new Hono<ApiEnv>();
  auth.use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next(); });
  auth.use('*', csrfGuard(() => apiDeps.allowedOrigins));
  auth.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error('登录服务失败', error);
    return c.json({ error: '登录服务暂时不可用' }, 503);
  });
  auth.route('/', sessionRoutes(store, apiDeps));
  app.route('/auth', auth);
  app.onError((error, c) => {
    if (!store.getActiveToken(c.req.query('token') ?? '')) return notFound(c);
    if (error instanceof HttpError) return c.text(error.message, error.status);
    if (error instanceof ResourceAccessError) return notFound(c);
    console.error('资源读取失败', error);
    return c.text('资源暂时不可用，请稍后重试', 503);
  });
  for (const prefix of ['/subs/*', '/resources/*']) {
    app.use(prefix, uniqueQuery);
    app.use(prefix, async (c, next) => {
      c.header('cache-control', 'no-store'); c.header('x-content-type-options', 'nosniff'); c.header('referrer-policy', 'no-referrer');
      const token = c.req.query('token'), user = token ? store.getActiveToken(token) : undefined;
      if (!user || !['GET', 'HEAD'].includes(c.req.method)) return notFound(c);
      const profile = c.req.path === '/subs/profile' ? c.req.query('id') : c.req.path.startsWith('/subs/') ? c.req.query('profile') : undefined;
      const key = c.req.query('key');
      const shared = key && c.req.path.startsWith('/resources/') ? store.getSharedRule<SharedRuleRecord>(key)?.reference.matcher : undefined;
      const ruleset = c.req.path === '/resources/ruleset' ? shared?.id ?? c.req.query('id') : undefined;
      const repositories = new Set<string>([
        ...(c.req.path === '/resources/repo' && !key && c.req.query('id') ? [c.req.query('id')!] : []),
        ...(shared?.repository ? [shared.repository.repo] : []),
        ...(ruleset ? store.get('ruleset', ruleset)?.sources.flatMap(source => source.repository ? [source.repository.repo] : []) ?? [] : []),
      ]);
      let deleted = false;
      const invalidate = (kind: string, id: string) => {
        if (kind === 'profile' && id === profile || kind === 'ruleset' && id === ruleset || kind === 'shared-rule' && id === key || kind === 'repository' && repositories.has(id)
          || c.req.path === '/subs/nodes' && kind === c.req.query('kind') && id === c.req.query('id')) deleted = true;
      };
      store.invalidationListeners.add(invalidate);
      try {
        await next();
        if (deleted || store.getActiveToken(token!)?.userId !== user.userId) c.res = new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
      } finally { store.invalidationListeners.delete(invalidate); }
    });
  }
  app.route('/resources', resourceFileRoutes(store, renderer, deps.snapshots, ruleRepos));
  app.route('/subs', subscriptionRuleRoutes(store, renderer, deps.snapshots));

  app.get('/subs/profile', async (c) => {
    allowedQuery(c, ['id', 'target', 'platform', 'app', 'token']);
    c.header('cache-control', 'no-store');
    c.header('vary', 'User-Agent');
    const token = c.req.query('token')!;
    const t = store.getActiveToken(token);
    if (!t) return notFound(c);
    const profileId = requiredQuery(c, 'id');
    const owned = store.getWithOwner('profile', profileId);
    if (!owned || owned.owner !== t.userId) return notFound(c);
    const profile = owned.doc;
    const ua = c.req.header('user-agent') ?? '';
    let detected;
    try { detected = detectClient(ua, { target: c.req.query('target'), platform: c.req.query('platform'), app: c.req.query('app') }); }
    catch (error) { if (error instanceof InvalidClientTarget) return c.text(error.message, 400); throw error; }

    const setAccessResult = (outcome?: RenderOutcome) => c.set('accessResult', {
      warnings: outcome?.ok ? outcome.render.warnings : 0,
      source: outcome ? (outcome.ok ? outcome.source : 'failed') : 'unsupported',
    });

    if (detected.client !== 'mihomo' && detected.platform && detected.platform !== 'ios' && detected.platform !== 'macos') {
      setAccessResult(); return c.text('该客户端平台仅支持 ios 或 macos', 400);
    }

    const outcome = await renderer.render(profileId, { client: detected.client, ...(detected.platform ? { platform: detected.platform } : {}), ...(detected.app ? { app: detected.app } : {}) });
    if (store.getActiveToken(token)?.userId !== t.userId || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    if (outcome.ok && !renderer.canReadNodes(outcome.render, t.userId)) return notFound(c);
    if (outcome.ok && !renderer.canReadRules(profileId, outcome.render)) return notFound(c);
    if (!outcome.ok) {
      setAccessResult(outcome);
      return c.text(`订阅暂时不可用：${outcome.message}`, 503);
    }
    const interval = store.resourceCacheTtlSec;
    c.header('content-type', 'text/plain; charset=utf-8');
    c.header('x-content-type-options', 'nosniff');
    c.header('cache-control', 'no-store');
    c.header('profile-update-interval', String(Math.max(1, Math.round(interval / 3600))));
    c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(profile.name)}`);
    const ui = userinfoHeader(outcome.render.userinfo);
    if (ui) c.header('subscription-userinfo', ui);
    setAccessResult(outcome);
    return c.body(outcome.render.yaml.replaceAll(TOKEN_PLACEHOLDER, token));
  });

  /** 私有节点产物按当前配置生成，并检查用户归属。 */
  app.get('/subs/nodes', async (c, next) => {
    if (c.req.query('kind') !== 'provider') return next();
    allowedQuery(c, ['kind', 'profile', 'id', 'target', 'platform', 'app', 'token']);
    c.header('cache-control', 'no-store');
    const token = c.req.query('token')!;
    const t = store.getActiveToken(token);
    const profileId = requiredQuery(c, 'profile');
    if (!t || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    const qp = c.req.query('platform');
    const platform = PLATFORMS.find((p) => p === qp);
    if (qp !== undefined && !platform) return notFound(c);
    const client = c.req.query('target') ?? 'mihomo';
    if (client !== 'mihomo' && client !== 'stash' && client !== 'surge' && client !== 'loon') return notFound(c);
    if (client !== 'mihomo' && platform && platform !== 'ios' && platform !== 'macos') return notFound(c);
    let target: Target;
    try { target = detectClient('', { target: client, platform, app: c.req.query('app') }); } catch (error) { if (error instanceof InvalidClientTarget) return notFound(c); throw error; }
    const key = requiredQuery(c, 'id');
    const outcome = await renderer.render(profileId, target);
    if (store.getActiveToken(token)?.userId !== t.userId || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    if (!outcome.ok) return outcome.accessDenied ? notFound(c) : c.text(`节点暂时不可用：${outcome.message}`, 503);
    const selected = outcome.render;
    if (!renderer.canReadNodes(selected, t.userId) || typeof selected.providers[key] !== 'string') return notFound(c);
    const traffic = userinfoHeader(selected.providerUserinfo?.[key]);
    if (traffic) c.header('subscription-userinfo', traffic);
    c.header('content-type', 'text/plain; charset=utf-8');
    c.header('content-disposition', 'inline');
    c.header('x-content-type-options', 'nosniff');
    return c.body(selected.providers[key]!.replaceAll(TOKEN_PLACEHOLDER, token));
  });

  app.get('/subs/nodes', async c => {
    allowedQuery(c, ['kind', 'id', 'target', 'platform', 'app', 'token']);
    c.header('cache-control', 'no-store');
    c.header('vary', 'User-Agent');
    const token = c.req.query('token')!;
    const user = store.getActiveToken(token);
    const kind = requiredQuery(c, 'kind');
    const id = requiredQuery(c, 'id');
    if (!user || !['source', 'collection', 'local'].includes(kind)) return notFound(c);
    const type = kind as 'source' | 'collection' | 'local';
    if (store.getWithOwner(type, id)?.owner !== user.userId) return notFound(c);
    let target;
    try { target = detectClient(c.req.header('user-agent') ?? '', c.req.query()); }
    catch (error) { if (error instanceof InvalidClientTarget) return c.text(error.message, 400); throw error; }
    if (target.client !== 'mihomo' && target.platform && !['ios', 'macos'].includes(target.platform)) return c.text('该客户端平台仅支持 ios 或 macos', 400);
    try {
      const result = await renderer.nodeSet({ type, id }, user.userId, { client: target.client, ...(target.platform ? { platform: target.platform } : {}) });
      if (store.getActiveToken(token)?.userId !== user.userId || store.getWithOwner(type, id)?.owner !== user.userId) return notFound(c);
      const traffic = userinfoHeader(result.userinfo);
      if (traffic) c.header('subscription-userinfo', traffic);
      c.header('profile-update-interval', String(Math.max(1, Math.round(store.resourceCacheTtlSec / 3600))));
      c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(store.get(type, id)!.name)}`);
      c.header('content-type', 'text/plain; charset=utf-8');
      c.header('x-content-type-options', 'nosniff');
      return c.body(result.yaml);
    } catch (error) {
      if (store.getActiveToken(token)?.userId !== user.userId || store.getWithOwner(type, id)?.owner !== user.userId) return notFound(c);
      if (error instanceof ResourceAccessError) return notFound(c);
      return c.text(`节点资源暂时不可用：${error instanceof Error ? error.message : String(error)}`, 503);
    }
  });

  if (deps.webDir) serveWeb(app, deps.webDir);

  return app;
}
