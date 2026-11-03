import { Hono, type Context } from 'hono';
import { managedRuleDelivery, Report, resolveProfileRouting, type RuleResourceReference, type RuleSetDelivery } from '@sub-forge/core';
import type { DownloadEnv } from './access-log.ts';
import type { Store } from './store.ts';
import type { RenderService, Target } from './render.ts';
import type { SnapshotService } from './snapshots.ts';
import type { RuleRepoService } from './rule-repos/service.ts';
import { profileTemplate } from './profile-routing.ts';
import { RuleSourceService } from './rule-source.ts';
import { RuleConverter } from './rule-converter.ts';
import { ruleSourceFile } from './rule-files.ts';
import { allowedQuery, requiredQuery } from './query.ts';
import { HttpError } from './api/common.ts';
import { detectClient, InvalidClientTarget } from './client.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';

function target(c: Context, subscription = false): Target {
  try {
    const value = detectClient(c.req.header('user-agent') ?? '', c.req.query());
    return subscription ? value : { client: value.client };
  } catch (error) {
    if (error instanceof InvalidClientTarget) throw new HttpError(400, error.message);
    throw error;
  }
}

/** 主配置写入的格式契约：旧配置的文本 provider 不能收到 MRS 字节，反之亦然。 */
function checkDeliveryContract(c: Context, delivery: RuleSetDelivery) {
  const format = c.req.query('format');
  if (format === undefined) return;
  if (delivery.mode !== 'managed' || format !== delivery.format || (delivery.format === 'mrs' && c.req.query('behavior') !== delivery.behavior)) throw new HttpError(409, '规则输出格式已变化，请刷新主订阅以使用新资源');
}

function ruleOptions(c: Context): RuleResourceReference['options'] {
  const src = c.req.query('src');
  if (src !== undefined && src !== '1') throw new HttpError(400, '规则处理参数不合法');
  return src ? { src: true } : undefined;
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
  // 2026-11-02 前主配置使用的 key 地址已失效，客户端刷新主订阅后获得新地址。
  app.use('*', async (c, next) => { if (c.req.query('key') !== undefined) return c.body(null, 404); await next(); });
  app.get('/ruleset', async c => {
    allowedQuery(c, ['id', 'view', 'target', 'platform', 'format', 'behavior', 'src', 'token']);
    const id = requiredQuery(c, 'id');
    const read = () => store.get('ruleset', id) ? { kind: 'ruleset' as const, id } : undefined;
    if (!read()) return c.body(null, 404);
    if (c.req.query('view') === 'source') return ruleSourceFile(c, store, getter, store.getActiveToken(c.req.query('token')!)!.userId, read);
    if (c.req.query('view') !== undefined && c.req.query('view') !== 'output') throw new HttpError(400, '文件视图不合法');
    const options = ruleOptions(c), reference = { matcher: read()!, ...(options ? { options } : {}) }, output = target(c);
    c.header('vary', 'User-Agent');
    const definition = resolveRuleSetReference(reference.matcher, store);
    const delivery = definition && managedRuleDelivery(definition, output, options);
    // 不支持是确定结果，不能落入通用 503 让客户端当作临时故障。
    if (delivery?.mode === 'unsupported') throw new HttpError(409, delivery.reason);
    if (delivery) checkDeliveryContract(c, delivery);
    const result = await renderer.sharedRules.read(reference, output);
    if (!result || !read()) return c.body(null, 404);
    c.set('accessResource', { kind: 'enhancement', resourceId: id, resourceName: result.name });
    return ruleBody(c, result.body);
  });
  app.get('/repo', async c => {
    const convert = c.req.query('target') !== undefined;
    allowedQuery(c, convert ? ['id', 'files', 'target', 'format', 'behavior', 'src', 'token'] : ['id', 'ref', 'path', 'files', 'token']);
    const id = requiredQuery(c, 'id');
    let files: { ref: string; path: string }[];
    if (c.req.query('files') !== undefined) {
      if (c.req.query('ref') !== undefined || c.req.query('path') !== undefined) throw new HttpError(400, '仓库文件参数冲突');
      try { files = JSON.parse(c.req.query('files')!); } catch { throw new HttpError(400, '仓库文件参数不合法'); }
      if (!Array.isArray(files) || !files.length || files.length > 50 || files.some(file => !file || typeof file.ref !== 'string' || typeof file.path !== 'string' || Object.keys(file).some(k => k !== 'ref' && k !== 'path'))) throw new HttpError(400, '仓库文件参数不合法');
    } else files = [{ ref: requiredQuery(c, 'ref'), path: requiredQuery(c, 'path') }];
    if (convert) {
      // 转换结果与原文入口共用索引校验：仓库停用、删除或文件失效后不可读，也不接受任意上游 URL。
      const definition = () => repos.ruleSetFromFiles(id, files), rs = definition();
      if (!rs) return c.body(null, 404);
      const options = ruleOptions(c), output = target(c), delivery = managedRuleDelivery(rs, output, options);
      checkDeliveryContract(c, delivery);
      const result = await renderer.sharedRules.read({ matcher: { kind: 'ruleset', id: rs.id }, ...(options ? { options } : {}) }, output, definition);
      if (!result) return c.body(null, 404);
      c.set('accessResource', { kind: 'rule-collection', resourceId: rs.id, resourceName: rs.name });
      return ruleBody(c, result.body);
    }
    // 先验证全部文件属于当前启用索引，再读取；多来源也不接受任意上游 URL。
    const identities = files.map(file => repos.fileUrl(id, file.ref, file.path));
    const bodies: string[] = [];
    let name = '';
    for (const file of files) {
      const result = await repos.filePreview(id, file.ref, file.path);
      bodies.push(result.content); name ||= result.name;
    }
    if (files.some((file, index) => repos.fileUrl(id, file.ref, file.path) !== identities[index])) throw new HttpError(409, '仓库文件在读取期间发生变化');
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
      }, { kind: 'profile', id: profileId });
    }
    allowedQuery(c, ['profile', 'key', 'target', 'platform', 'app', 'token']);
    const key = requiredQuery(c, 'key'), output = target(c, true);
    const profile = () => owned() ? store.get('profile', profileId) : undefined;
    const reference = renderer.profileRule(profile()!, output, key);
    // 只有托管规则有地址；规则已从配置移除或地址过期都是 404。
    if (!reference) return c.body(null, 404);
    const name = `${profile()!.name} · 专属规则`;
    // 上游读取期间配置可能变化：定义不再存在的规则不能下发，手写规则没有规则集文档，只提供名称。
    const definition = () => {
      const current = profile();
      if (!current || !renderer.profileRule(current, output, key)) return undefined;
      return reference.matcher.kind === 'ruleset' ? resolveRuleSetReference(reference.matcher, store) : { id: '$local', name, sources: [] };
    };
    let result;
    try { result = await renderer.sharedRules.read(reference, output, definition); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      return c.text(`规则暂时不可用：${(error as Error).message}`, 503);
    }
    if (!result || !owned()) return c.body(null, 404);
    c.set('accessResource', { kind: 'rule-collection', resourceId: key, resourceName: name });
    return ruleBody(c, result.body);
  });
  return app;
}
