import { Hono, type Context } from 'hono';
import { Report, resolveProfileRouting } from '@sub-forge/core';
import type { DownloadEnv } from './access-log.ts';
import type { Store } from './store.ts';
import type { RenderService, Target } from './render.ts';
import type { SnapshotService } from './snapshots.ts';
import type { SharedRuleRecord } from './shared-rules.ts';
import type { RuleRepoService } from './rule-repos/service.ts';
import { profileTemplate } from './profile-routing.ts';
import { RuleSourceService } from './rule-source.ts';
import { RuleConverter } from './rule-converter.ts';
import { ruleSourceFile } from './rule-files.ts';
import { allowedQuery, requiredQuery } from './query.ts';
import { HttpError } from './api/common.ts';
import { detectClient, InvalidClientTarget } from './client.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';

function target(c: Context): Target {
  try {
    const value = detectClient(c.req.header('user-agent') ?? '', c.req.query());
    if (value.client !== 'mihomo' && value.platform && !['ios', 'macos'].includes(value.platform)) throw new HttpError(400, '该客户端仅支持 ios 或 macos');
    return { client: value.client, ...(value.platform ? { platform: value.platform } : {}) };
  } catch (error) {
    if (error instanceof InvalidClientTarget) throw new HttpError(400, error.message);
    throw error;
  }
}

function ruleBody(c: Context, body: string) {
  c.header('content-disposition', 'inline');
  if (body.startsWith('#subforge-binary-mrs\n')) {
    c.header('content-type', 'application/octet-stream');
    return c.body(Buffer.from(body.slice('#subforge-binary-mrs\n'.length), 'base64'));
  }
  return c.text(body);
}

export function resourceFileRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService, repos: RuleRepoService) {
  const app = new Hono<DownloadEnv>();
  const getter = new RuleSourceService(snapshots, new RuleConverter());
  const shared = async (c: Context, repository: boolean) => {
    allowedQuery(c, ['key', 'token']);
    const key = requiredQuery(c, 'key');
    const read = () => {
      const record = store.getSharedRule<SharedRuleRecord>(key);
      return record && !record.reference.matcher.remote && !!record.reference.matcher.repository === repository && resolveRuleSetReference(record.reference.matcher, store) ? record : undefined;
    };
    if (!read()) return c.body(null, 404);
    const body = await renderer.sharedRules.read(key), record = read();
    if (body === undefined || !record) return c.body(null, 404);
    c.set('accessResource', { kind: repository ? 'rule-collection' : 'enhancement', resourceId: key, resourceName: record.name });
    if (record.error) c.header('x-sub-forge-warning', 'last-good-rule');
    return ruleBody(c, body);
  };
  app.get('/ruleset', async c => {
    if (c.req.query('key') !== undefined) return shared(c, false);
    allowedQuery(c, ['id', 'view', 'target', 'platform', 'token']);
    const id = requiredQuery(c, 'id');
    const read = () => store.get('ruleset', id) ? { kind: 'ruleset' as const, id } : undefined;
    if (!read()) return c.body(null, 404);
    if (c.req.query('view') === 'source') return ruleSourceFile(c, store, getter, store.getActiveToken(c.req.query('token')!)!.userId, read);
    if (c.req.query('view') !== undefined && c.req.query('view') !== 'output') throw new HttpError(400, '文件视图不合法');
    const reference = { matcher: read()! }, output = target(c);
    c.header('vary', 'User-Agent');
    const body = await renderer.sharedRules.readReference(reference, output);
    if (body === undefined || !read() || !resolveRuleSetReference(reference.matcher, store)) return c.body(null, 404);
    const record = store.getSharedRule<SharedRuleRecord>(renderer.sharedRules.key(reference, output));
    if (!record) return c.body(null, 404);
    c.set('accessResource', { kind: 'enhancement', resourceId: id, resourceName: record.name });
    if (record.error) c.header('x-sub-forge-warning', 'last-good-rule');
    return ruleBody(c, body);
  });
  app.get('/repo', async c => {
    if (c.req.query('key') !== undefined) return shared(c, true);
    allowedQuery(c, ['id', 'ref', 'path', 'files', 'token']);
    const id = requiredQuery(c, 'id');
    let files: { ref: string; path: string }[];
    if (c.req.query('files') !== undefined) {
      if (c.req.query('ref') !== undefined || c.req.query('path') !== undefined) throw new HttpError(400, '仓库文件参数冲突');
      try { files = JSON.parse(c.req.query('files')!); } catch { throw new HttpError(400, '仓库文件参数不合法'); }
      if (!Array.isArray(files) || !files.length || files.length > 50 || files.some(file => !file || typeof file.ref !== 'string' || typeof file.path !== 'string' || Object.keys(file).some(k => k !== 'ref' && k !== 'path'))) throw new HttpError(400, '仓库文件参数不合法');
    } else files = [{ ref: requiredQuery(c, 'ref'), path: requiredQuery(c, 'path') }];
    // 先验证全部文件属于当前启用索引，再读取；多来源也不接受任意上游 URL。
    const identities = files.map(file => repos.fileResource(id, file.ref, file.path).url);
    const bodies: string[] = [];
    let name = '';
    for (const file of files) {
      const result = await repos.filePreview(id, file.ref, file.path);
      bodies.push(result.content); name ||= result.name;
      if (result.cache?.error) c.header('x-sub-forge-warning', 'last-good-source');
    }
    if (files.some((file, index) => repos.fileResource(id, file.ref, file.path).url !== identities[index])) throw new HttpError(409, '仓库文件在读取期间发生变化');
    c.set('accessResource', { kind: 'rule-collection', resourceId: `${id}:${files.map(file => `${file.ref}:${file.path}`).join(',')}`, resourceName: name });
    c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    return c.text(bodies.join('\n'));
  });
  return app;
}

export function subscriptionRuleRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService) {
  const app = new Hono<DownloadEnv>();
  const getter = new RuleSourceService(snapshots, new RuleConverter());
  app.get('/ruleset', async c => {
    const profileId = requiredQuery(c, 'profile'), user = store.getActiveToken(c.req.query('token')!)!;
    const owned = () => store.getWithOwner('profile', profileId)?.owner === user.userId;
    if (!owned()) return c.body(null, 404);
    if (c.req.query('view') === 'source') {
      allowedQuery(c, ['profile', 'rule', 'revision', 'view', 'token']);
      const rule = requiredQuery(c, 'rule');
      return ruleSourceFile(c, store, getter, user.userId, () => {
        const profile = store.get('profile', profileId);
        if (!owned() || !profile) return undefined;
        const template = profileTemplate(profile, (id, version) => store.getTemplate(id, version));
        const matcher = resolveProfileRouting(profile, template, new Report()).rules.find(r => r.id === rule)?.matcher;
        return matcher?.kind === 'ruleset' && matcher.remote ? matcher : undefined;
      }, `profile:${profileId}`, { kind: 'profile', id: profileId });
    }
    allowedQuery(c, ['profile', 'key', 'target', 'platform', 'token']);
    const key = requiredQuery(c, 'key'), output = target(c);
    const result = await renderer.render(profileId, output);
    if (!owned()) return c.body(null, 404);
    if (!result.ok) return result.accessDenied ? c.body(null, 404) : c.text(`规则暂时不可用：${result.message}`, 503);
    const selected = result.render.privateRules?.[key];
    if (!selected || !renderer.canReadRule(profileId, selected.reference)) return c.body(null, 404);
    c.set('accessResource', { kind: 'rule-collection', resourceId: key, resourceName: store.get('profile', profileId)!.name + ' · 专属规则' });
    if (result.source === 'last-good') c.header('x-sub-forge-warning', 'last-good-rule');
    return ruleBody(c, selected.body);
  });
  return app;
}
