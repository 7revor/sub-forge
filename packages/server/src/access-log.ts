import type { MiddlewareHandler } from 'hono';
import { detectClient, InvalidClientTarget } from './client.ts';
import type { SharedRuleRecord } from './shared-rules.ts';
import type { AccessKind, Store } from './store.ts';

export type DownloadEnv = { Variables: { accessResult: { source: string; warnings: number }; accessResource: { kind: AccessKind; resourceId: string; resourceName: string } } };

/** 日志仅保存资源身份和凭证摘要，不保存带 token 的 URL。 */
export function accessLogger(store: Store, now: () => number): MiddlewareHandler<DownloadEnv> {
  const paths = new Set(['/subs/profile', '/subs/nodes', '/subs/ruleset', '/resources/ruleset', '/resources/repo']);
  return async (c, next) => {
    if (!paths.has(c.req.path) || !['GET', 'HEAD'].includes(c.req.method)) return next();
    const tokens = c.req.queries('token');
    const token = tokens?.length === 1 ? tokens[0] : undefined;
    const user = token ? store.getActiveToken(token) : undefined;
    if (!user) return next();
    const started = now(), ua = c.req.header('user-agent') ?? '';
    let client = '未知', platform: string | undefined;
    try {
      const detected = detectClient(ua, c.req.query());
      client = detected.client + (detected.by === 'default' ? '?' : ''); platform = detected.platform;
    } catch (error) { if (!(error instanceof InvalidClientTarget)) throw error; client = '无效参数'; }
    await next();
    if (store.getActiveToken(token!)?.userId !== user.userId) return;
    const path = c.req.path, id = c.req.query('id') ?? '', key = c.req.query('key');
    let kind: AccessKind = path.endsWith('/nodes') ? 'nodes' : path === '/subs/profile' ? 'subscription' : path === '/resources/ruleset' ? 'enhancement' : 'rule-collection';
    let profileId = '', resourceId = key ?? id, resourceName = '不可用资源';
    const profile = path === '/subs/profile' ? id : path.startsWith('/subs/') ? c.req.query('profile') : undefined;
    if (profile) {
      const row = store.getWithOwner('profile', profile);
      if (row?.owner === user.userId) { profileId = profile; resourceName = row.doc.name; }
      resourceId = [profile, key ?? id].filter(Boolean).join('/');
    } else if (path === '/subs/nodes') {
      const type = c.req.query('kind');
      if (type === 'source' || type === 'collection' || type === 'local') {
        const row = store.getWithOwner(type, id);
        if (row?.owner === user.userId) resourceName = row.doc.name;
        resourceId = `${type}/${id}`;
      }
    } else if (path === '/resources/ruleset' && !key) resourceName = store.get('ruleset', id)?.name ?? resourceName;
    if (key && path.startsWith('/resources/')) {
      const record = store.getSharedRule<SharedRuleRecord>(key);
      if (record && !record.reference.matcher.remote) { client = record.target.client; platform = record.target.platform; }
    }
    const resource = c.get('accessResource');
    if (resource) { kind = resource.kind; resourceId = resource.resourceId; resourceName = resource.resourceName; }
    const file = c.req.query('view') === 'source' || path === '/resources/repo' && !key;
    if (file) client = '原文';
    const result = c.get('accessResult'), fallback = !!c.res.headers.get('x-sub-forge-warning');
    store.logAccess({ token: token!, profileId, kind, resourceId, resourceName, method: c.req.method, at: started, ua, client, ...(platform ? { platform } : {}),
      status: c.res.status, ms: Math.max(0, now() - started), warnings: result?.warnings ?? (fallback ? 1 : 0), source: result?.source ?? (c.res.status >= 400 ? 'failed' : fallback ? 'last-good' : file ? 'file' : 'managed') });
  };
}
