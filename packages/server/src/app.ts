// 订阅接口（OUT-01 – OUT-06）：
//   GET /sub/:token          主配置
//   GET /p/:token/:key       Profile 专属 provider 内容
//   GET /r/:token/:key       转换后的规则集
// token 无效一律 404 且不暴露 Profile 是否存在；从未成功渲染时 503 + 纯文本说明，不返回半成品。

import { Hono, type Context } from 'hono';
import type { Platform } from '@sub-forge/core';
import { createApi, type ApiDeps } from './api/index.ts';
import { detectClient } from './client.ts';
import { TOKEN_PLACEHOLDER, type RenderOutcome, type RenderService, type StoredRender } from './render.ts';
import type { Store, TrafficInfo } from './store.ts';

const DEFAULT_INTERVAL_SEC = 86400;
const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];

function userinfoHeader(u: TrafficInfo | undefined): string | undefined {
  if (!u) return undefined;
  const parts = (['upload', 'download', 'total', 'expire'] as const).filter((k) => u[k] !== undefined).map((k) => `${k}=${u[k]}`);
  return parts.length ? parts.join('; ') : undefined;
}

const notFound = (c: Context) => c.body(null, 404);

export type AppDeps = Omit<ApiDeps, 'now' | 'secureCookies' | 'allowedOrigins' | 'publicUrl'> & Partial<Pick<ApiDeps, 'now' | 'secureCookies' | 'allowedOrigins' | 'publicUrl'>>;

export function createApp(deps: AppDeps) {
  const { store, renderer } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono();

  app.get('/healthz', (c) => c.text('ok'));
  app.route('/api', createApi({ ...deps, now, secureCookies: deps.secureCookies ?? false, allowedOrigins: deps.allowedOrigins ?? [], publicUrl: deps.publicUrl ?? '' }));

  app.get('/sub/:token', async (c) => {
    const started = now();
    const token = c.req.param('token');
    const t = store.getToken(token);
    if (!t) return notFound(c);
    const profile = store.get('profile', t.profileId);
    if (!profile) return notFound(c);
    const ua = c.req.header('user-agent') ?? '';
    const detected = detectClient(ua, { target: c.req.query('target'), platform: c.req.query('platform') });

    const log = (status: number, outcome?: RenderOutcome) => store.logAccess({
      token, profileId: t.profileId, at: started, ua, client: `${detected.client}${detected.by === 'default' ? '?' : ''}`,
      ...(detected.platform ? { platform: detected.platform } : {}),
      status, ms: now() - started,
      warnings: outcome?.ok ? outcome.render.warnings : 0,
      source: outcome ? (outcome.ok ? outcome.source : 'failed') : 'unsupported',
    });

    if (detected.client === 'surge') {
      log(501);
      return c.text('Surge 输出尚未实现（M2）。如需 mihomo 配置，请在链接后加 ?target=mihomo', 501);
    }

    const outcome = await renderer.render(t.profileId, detected.platform ? { client: 'mihomo', platform: detected.platform } : { client: 'mihomo' });
    if (!outcome.ok) {
      log(503, outcome);
      return c.text(`订阅暂时不可用：${outcome.message}`, 503);
    }
    const interval = profile.updateIntervalSec ?? DEFAULT_INTERVAL_SEC;
    c.header('content-type', 'text/yaml; charset=utf-8');
    c.header('cache-control', 'no-store');
    c.header('profile-update-interval', String(Math.max(1, Math.round(interval / 3600))));
    c.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(profile.name)}`);
    const ui = userinfoHeader(outcome.render.userinfo);
    if (ui) c.header('subscription-userinfo', ui);
    log(200, outcome);
    return c.body(outcome.render.yaml.replaceAll(TOKEN_PLACEHOLDER, token));
  });

  /** provider 与规则集共用：按 token 找到 Profile，取同一次渲染里的对应内容 */
  const part = (pick: (r: StoredRender, key: string) => string | undefined, contentType: string) => async (c: Context) => {
    const token = c.req.param('token')!;
    const t = store.getToken(token);
    if (!t) return notFound(c);
    const qp = c.req.query('platform');
    const platform = PLATFORMS.find((p) => p === qp);
    const outcome = await renderer.render(t.profileId, platform ? { client: 'mihomo', platform } : { client: 'mihomo' });
    if (!outcome.ok) return c.text(`暂时不可用：${outcome.message}`, 503);
    const body = pick(outcome.render, c.req.param('key')!);
    if (body === undefined) return notFound(c);
    c.header('content-type', contentType);
    c.header('cache-control', 'no-store');
    return c.body(body.replaceAll(TOKEN_PLACEHOLDER, token));
  };

  app.get('/p/:token/:key', part((r, k) => r.providers[k], 'text/yaml; charset=utf-8'));
  app.get('/r/:token/:key', part((r, k) => r.rulesets[k], 'text/plain; charset=utf-8'));

  return app;
}
