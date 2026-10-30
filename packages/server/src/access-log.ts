import type { MiddlewareHandler } from 'hono';
import { detectClient, InvalidClientTarget } from './client.ts';
import type { SharedRuleRecord } from './shared-rules.ts';
import type { AccessKind, Store } from './store.ts';

export type DownloadEnv = { Variables: { accessResult: { source: string; warnings: number }; accessResource: { kind: AccessKind; resourceId: string; resourceName: string } } };

/** 只覆盖下载入口；归属由实际凭证决定，与资源创建人、登录会话无关。 */
export function accessLogger(store: Store, now: () => number): MiddlewareHandler<DownloadEnv> {
  return async (c, next) => {
    const match = /^\/(sub|p|r|rules|nodes)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(c.req.path);
    const file = /^\/api\/files\/([^/]+)\/(?:repository|(?:templates|profiles)\/[^/]+\/rules\/[^/]+)$/.exec(c.req.path);
    if ((!match && !file) || !['GET', 'HEAD'].includes(c.req.method)) return next();
    const [, route, encodedToken, encodedId, encodedKey] = match ?? ['', 'file', file![1], 'file', ''];
    let token: string, id: string, key: string;
    try { token = decodeURIComponent(encodedToken!); id = decodeURIComponent(encodedId!); key = decodeURIComponent(encodedKey ?? ''); }
    catch (error) { if (error instanceof URIError) return next(); throw error; }
    if ((route === 'p' || route === 'nodes') !== !!key) return next();
    const user = store.getActiveToken(token);
    if (!user) return next();
    const started = now();
    const ua = c.req.header('user-agent') ?? '';
    let client = '未知', platform: string | undefined;
    try {
      const detected = detectClient(ua, c.req.query());
      client = detected.client + (detected.by === 'default' ? '?' : ''); platform = detected.platform;
    } catch (error) { if (!(error instanceof InvalidClientTarget)) throw error; client = '无效参数'; }
    await next();
    if (store.getActiveToken(token)?.userId !== user.userId) return;
    let kind: AccessKind = 'subscription', profileId = '', resourceId = id!, resourceName = '不可用资源';
    if (route === 'sub' || route === 'p') {
      kind = route === 'sub' ? 'subscription' : 'nodes';
      const profile = store.getWithOwner('profile', id!);
      if (profile?.owner === user.userId) { profileId = id!; resourceName = profile.doc.name + (route === 'p' ? ' · 节点' : ''); }
      if (key) resourceId += '/' + key;
    } else if (route === 'nodes') {
      kind = 'nodes'; resourceId = id + '/' + key;
      if (id === 'source' || id === 'local' || id === 'collection') {
        const nodeSet = store.getWithOwner(id, key);
        if (nodeSet?.owner === user.userId) resourceName = nodeSet.doc.name;
      }
    } else if (route === 'rules') {
      kind = 'enhancement'; resourceName = store.get('ruleset', id!)?.name ?? resourceName;
    } else if (route === 'file') {
      const resource = c.get('accessResource');
      kind = resource?.kind ?? 'rule-collection'; resourceId = resource?.resourceId ?? 'file'; resourceName = resource?.resourceName ?? resourceName; client = '原文';
    } else {
      const resource = store.getSharedRule<SharedRuleRecord>(id!);
      const matcher = resource?.reference.matcher;
      kind = matcher && !matcher.remote && !matcher.repository ? 'enhancement' : 'rule-collection';
      if (resource) { resourceName = resource.name; client = resource.target.client; platform = undefined; }
    }
    const result = c.get('accessResult');
    const fallback = !!c.res.headers.get('x-sub-forge-warning');
    store.logAccess({ token, profileId, kind, resourceId, resourceName, method: c.req.method, at: started, ua, client, ...(platform ? { platform } : {}),
      status: c.res.status, ms: Math.max(0, now() - started), warnings: result?.warnings ?? (fallback ? 1 : 0), source: result?.source ?? (c.res.status >= 400 ? 'failed' : fallback ? 'last-good' : route === 'file' ? 'file' : 'managed') });
  };
}
