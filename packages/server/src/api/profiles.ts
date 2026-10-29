import { profileConversionRoutes } from './profile-conversion.ts';
// Profile 的附属接口：订阅链接（token）管理、预览与渲染报告、访问日志。

import { Hono } from 'hono';
import type { Platform } from '@sub-forge/core';
import { TOKEN_PLACEHOLDER, type RenderService } from '../render.ts';
import type { Store } from '../store.ts';
import { bad, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];

export function profileRoutes(store: Store, renderer: RenderService, publicUrl: string) {
  const app = new Hono<ApiEnv>();
  app.route('/', profileConversionRoutes(store));
  // 静态路径先注册；新建草稿不绑定任何已保存的 Profile。
  app.post('/profiles/preview', requireUser, async (c) => {
    const body = await jsonBody<{ profile?: unknown; client?: unknown; platform?: unknown }>(c);
    if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile)) throw bad('profile 必须是对象');
    const client = body.client ?? 'mihomo';
    if (client !== 'mihomo' && client !== 'stash') throw bad('目前支持 mihomo 与 Stash 预览');
    const platform = PLATFORMS.find((x) => x === body.platform);
    if (body.platform !== undefined && !platform) throw bad('platform 不合法');
    if (client === 'stash' && platform && platform !== 'ios' && platform !== 'macos') throw bad('Stash 平台仅支持 ios 或 macos');
    const draft = validateDoc('profile', body.profile as Record<string, unknown>, '', c.get('user'), store);
    const res = await renderer.previewDraft(draft, { client, ...(platform ? { platform } : {}) });
    return c.json(res.yaml ? { ...res, yaml: res.yaml.replaceAll(TOKEN_PLACEHOLDER, '{token}') } : res);
  });
  app.use('/profiles/:id/*', requireUser);

  const own = (id: string, userId: string) => {
    const row = store.getWithOwner('profile', id);
    if (!row || row.owner !== userId) throw notFound('配置订阅');
    return row.doc;
  };
  const withUrl = (t: { token: string; label?: string; createdAt: number }) => ({ ...t, url: `${publicUrl.replace(/\/$/, '')}/sub/${t.token}` });

  // ---------- 订阅链接（PRF-02）----------

  app.get('/profiles/:id/tokens', (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    return c.json({ items: store.listTokens(p.id).map(withUrl) });
  });

  app.post('/profiles/:id/tokens', async (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    const { label } = await jsonBody<{ label?: unknown }>(c);
    if (label !== undefined && typeof label !== 'string') throw bad('label 必须是字符串');
    const t = store.createToken(p.id, label);
    return c.json({ item: withUrl({ ...t, createdAt: Date.now() }) }, 201);
  });

  /** 重置：旧链接立即失效，换一个新 token，保留备注 */
  app.post('/profiles/:id/tokens/:token/reset', (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    const old = store.getToken(c.req.param('token'));
    if (!old || old.profileId !== p.id) throw notFound('订阅链接');
    store.deleteToken(old.token);
    const t = store.createToken(p.id, old.label);
    return c.json({ item: withUrl({ ...t, createdAt: Date.now() }) });
  });

  app.delete('/profiles/:id/tokens/:token', (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    const old = store.getToken(c.req.param('token'));
    if (!old || old.profileId !== p.id) throw notFound('订阅链接');
    store.deleteToken(old.token);
    return c.json({ ok: true });
  });

  // ---------- 预览（CR-05 / 4.9 第 7 步）----------

  /** 预览已保存的 Profile；请求体可带未保存的 profile 草稿 */
  app.post('/profiles/:id/preview', async (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    const body = await jsonBody<{ platform?: unknown; client?: unknown; profile?: unknown }>(c);
    const client = body.client ?? 'mihomo';
    if (client !== 'mihomo' && client !== 'stash') throw bad('目前支持 mihomo 与 Stash 预览');
    const platform = PLATFORMS.find((x) => x === body.platform);
    if (body.platform !== undefined && !platform) throw bad('platform 不合法');
    if (client === 'stash' && platform && platform !== 'ios' && platform !== 'macos') throw bad('Stash 平台仅支持 ios 或 macos');
    // 草稿同样要做归属校验，否则可以借预览读到别人的节点集
    const draft = body.profile && typeof body.profile === 'object' ? validateDoc('profile', body.profile as Record<string, unknown>, p.id, c.get('user'), store) : undefined;
    const res = await renderer.preview(p.id, { client, ...(platform ? { platform } : {}) }, draft ? { profile: draft } : {});
    // 预览与具体订阅链接无关，地址里的 token 位置显示为 {token}
    return c.json(res.yaml ? { ...res, yaml: res.yaml.replaceAll(TOKEN_PLACEHOLDER, '{token}') } : res);
  });

  // ---------- 访问日志（PRF-07）----------

  app.get('/profiles/:id/access-log', (c) => {
    const p = own(c.req.param('id'), c.get('user').id);
    return c.json({ items: store.recentAccess(p.id, Math.min(Number(c.req.query('limit') ?? 50) || 50, 500)) });
  });

  return app;
}
