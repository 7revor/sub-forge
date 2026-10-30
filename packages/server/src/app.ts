// 订阅接口（OUT-01 – OUT-06）：
//   GET /sub/:token/:profile          主配置
//   GET /p/:token/:profile/:key       Profile 专属 provider 内容
//   GET /r/:token/:key       全站共享的托管规则集
// token 无效一律 404 且不暴露 Profile 是否存在；从未成功渲染时 503 + 纯文本说明，不返回半成品。

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
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
/** 这些前缀属于接口，不回落到前端页面 */
const RESERVED = ['/api/', '/sub/', '/p/', '/r/', '/rules/', '/nodes/'];

/** 托管前端：/assets 下的文件名带内容哈希，可长期缓存；index.html 不缓存 */
function serveWeb(app: Hono, webDir: string) {
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
    if (RESERVED.some((p) => path.startsWith(p)) || path === '/api') return c.body(null, 404);
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
  const app = new Hono();

  app.get('/healthz', (c) => c.text('ok'));
  app.route('/api', createApi({ ...deps, now, secureCookies: deps.secureCookies ?? false, allowedOrigins: deps.allowedOrigins ?? [], publicUrl: deps.publicUrl ?? '' }));

  app.get('/sub/:token/:profile', async (c) => {
    c.header('cache-control', 'no-store');
    c.header('vary', 'User-Agent');
    const started = now();
    const token = c.req.param('token');
    const t = store.getActiveToken(token);
    if (!t) return notFound(c);
    const profileId = c.req.param('profile');
    const owned = store.getWithOwner('profile', profileId);
    if (!owned || owned.owner !== t.userId) return notFound(c);
    const profile = owned.doc;
    const ua = c.req.header('user-agent') ?? '';
    let detected;
    try { detected = detectClient(ua, { target: c.req.query('target'), platform: c.req.query('platform') }); }
    catch (error) { if (error instanceof InvalidClientTarget) return c.text(error.message, 400); throw error; }

    const log = (status: number, outcome?: RenderOutcome) => store.logAccess({
      token, profileId: profileId, at: started, ua, client: `${detected.client}${detected.by === 'default' ? '?' : ''}`,
      ...(detected.platform ? { platform: detected.platform } : {}),
      status, ms: now() - started,
      warnings: outcome?.ok ? outcome.render.warnings : 0,
      source: outcome ? (outcome.ok ? outcome.source : 'failed') : 'unsupported',
    });

    if (detected.client !== 'mihomo' && detected.platform && detected.platform !== 'ios' && detected.platform !== 'macos') {
      log(400); return c.text('该客户端平台仅支持 ios 或 macos', 400);
    }

    const outcome = await renderer.render(profileId, { client: detected.client, ...(detected.platform ? { platform: detected.platform } : {}) });
    if (store.getActiveToken(token)?.userId !== t.userId || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    if (outcome.ok && !renderer.canReadNodes(outcome.render, t.userId)) return notFound(c);
    if (!outcome.ok) {
      log(503, outcome);
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
    log(200, outcome);
    return c.body(outcome.render.yaml.replaceAll(TOKEN_PLACEHOLDER, token));
  });

  /** 私有节点产物同时检查用户归属与主配置结构版本。 */
  app.get('/p/:token/:profile/:key', async c => {
    c.header('cache-control', 'no-store');
    const token = c.req.param('token');
    const t = store.getActiveToken(token);
    const profileId = c.req.param('profile');
    if (!t || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    const qp = c.req.query('platform');
    const platform = PLATFORMS.find((p) => p === qp);
    if (qp !== undefined && !platform) return notFound(c);
    const client = c.req.query('target') ?? 'mihomo';
    if (client !== 'mihomo' && client !== 'stash' && client !== 'surge' && client !== 'loon') return notFound(c);
    if (client !== 'mihomo' && platform && platform !== 'ios' && platform !== 'macos') return notFound(c);
    const target: Target = { client, ...(platform ? { platform } : {}) };
    const version = c.req.query('v');
    const key = c.req.param('key');
    if (!version) return notFound(c);
    const retained = renderer.getVersion(profileId, target, version);
    if (!retained || !renderer.canReadNodes(retained, t.userId) || typeof retained.providers[key] !== 'string') return notFound(c);
    const outcome = await renderer.render(profileId, target);
    if (store.getActiveToken(token)?.userId !== t.userId || store.getWithOwner('profile', profileId)?.owner !== t.userId) return notFound(c);
    if (!outcome.ok && outcome.accessDenied) return notFound(c);
    const selected = renderer.getVersion(profileId, target, version) ?? retained;
    if (!renderer.canReadNodes(selected, t.userId) || typeof selected.providers[key] !== 'string') return notFound(c);
    const traffic = userinfoHeader(selected.providerUserinfo?.[key]);
    if (traffic) c.header('subscription-userinfo', traffic);
    c.header('content-type', 'text/plain; charset=utf-8');
    c.header('content-disposition', 'inline');
    c.header('x-content-type-options', 'nosniff');
    return c.body(selected.providers[key]!.replaceAll(TOKEN_PLACEHOLDER, token));
  });

  /** 公共规则只检查有效用户 token；资源身份与用户、订阅无关。 */
  app.get('/r/:token/:key', async c => {
    c.header('cache-control', 'no-store');
    const token = c.req.param('token');
    const user = store.getActiveToken(token);
    if (!user) return notFound(c);
    try {
      const body = await renderer.sharedRules.read(c.req.param('key'));
      const resource = store.getSharedRule<{ error?: string }>(c.req.param('key'));
      if (store.getActiveToken(token)?.userId !== user.userId || !resource || body === undefined) return notFound(c);
      if (resource.error) c.header('x-sub-forge-warning', 'last-good-rule');
      if (body.startsWith('#subforge-binary-mrs\n')) {
        c.header('content-type', 'application/octet-stream');
        return c.body(Buffer.from(body.slice('#subforge-binary-mrs\n'.length), 'base64'));
      }
      c.header('content-type', 'text/plain; charset=utf-8');
      return c.body(body);
    } catch (error) {
      if (store.getActiveToken(token)?.userId !== user.userId) return notFound(c);
      return c.text(`规则资源暂时不可用：${error instanceof Error ? error.message : String(error)}`, 503);
    }
  });

  /** 增强集合的独立共享入口；客户端变体仍复用公共产物，与配置订阅无关。 */
  app.get('/rules/:token/:id', async c => {
    c.header('cache-control', 'no-store'); c.header('vary', 'User-Agent');
    const token = c.req.param('token'), id = c.req.param('id');
    const user = store.getActiveToken(token);
    if (!user || !store.get('ruleset', id)) return notFound(c);
    let target;
    try { target = detectClient(c.req.header('user-agent') ?? '', c.req.query()); }
    catch (error) { if (error instanceof InvalidClientTarget) return c.text(error.message, 400); throw error; }
    if (target.client !== 'mihomo' && target.platform && !['ios', 'macos'].includes(target.platform)) return c.text('该客户端平台仅支持 ios 或 macos', 400);
    const reference = { matcher: { kind: 'ruleset' as const, id } };
    const output = { client: target.client, ...(target.platform ? { platform: target.platform } : {}) };
    try {
      const body = await renderer.sharedRules.readReference(reference, output);
      if (store.getActiveToken(token)?.userId !== user.userId || !store.get('ruleset', id) || body === undefined) return notFound(c);
      const resource = store.getSharedRule<{ error?: string }>(renderer.sharedRules.key(reference, output));
      if (!resource) return notFound(c);
      if (resource.error) c.header('x-sub-forge-warning', 'last-good-rule');
      if (body.startsWith('#subforge-binary-mrs\n')) {
        c.header('content-type', 'application/octet-stream');
        return c.body(Buffer.from(body.slice('#subforge-binary-mrs\n'.length), 'base64'));
      }
      c.header('content-type', 'text/plain; charset=utf-8');
      return c.body(body);
    } catch (error) {
      if (store.getActiveToken(token)?.userId !== user.userId || !store.get('ruleset', id)) return notFound(c);
      return c.text(`规则资源暂时不可用：${error instanceof Error ? error.message : String(error)}`, 503);
    }
  });

  app.get('/nodes/:token/:kind/:id', async c => {
    c.header('cache-control', 'no-store');
    c.header('vary', 'User-Agent');
    const token = c.req.param('token');
    const user = store.getActiveToken(token);
    const kind = c.req.param('kind');
    const id = c.req.param('id');
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
