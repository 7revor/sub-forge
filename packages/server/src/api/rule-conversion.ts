// 来源获取与无 I/O 转换分别提供接口，客户端切换不会读取上游。
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { remoteRuleMatcher, type ClientCtx, type Platform } from '@sub-forge/core';
import type { RuleSetDoc, RuleSetSourceDoc } from '../docs.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { RenderService } from '../render.ts';
import type { Store } from '../store.ts';
import { RuleConverter, type ConversionInput } from '../rule-converter.ts';
import { RuleSourceService } from '../rule-source.ts';
import { bad, HttpError, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { checkFetch, checkRepositorySource, checkRuleSetOverrides } from './validate.ts';

const formats = ['auto', 'classical', 'domain', 'domain-set', 'ipcidr', 'yaml', 'mrs', 'srs'];
function source(value: unknown): RuleSetSourceDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('来源格式错误');
  const s = value as RuleSetSourceDoc;
  if (typeof s.id !== 'string' || !s.id || !['local', 'remote'].includes(s.kind)) throw bad('来源需要 id 和 kind');
  s.format ??= 'auto';
  if (!formats.includes(s.format)) throw bad('来源格式不合法');
  if (s.content !== undefined && typeof s.content !== 'string') throw bad('原文必须是字符串');
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') throw bad('enabled 必须是布尔值');
  if (s.kind === 'remote' && (typeof s.url !== 'string' || !/^https?:\/\/[^/]+/.test(s.url))) throw bad('请填写 http(s) 地址');
  if (s.repository !== undefined && (!s.repository || typeof s.repository !== 'object' || typeof s.repository.path !== 'string')) throw bad('仓库关联格式错误');
  if (s.behavior !== undefined && !['domain', 'ipcidr', 'classical'].includes(s.behavior)) throw bad('behavior 不合法');
  checkFetch(s.fetch);
  if (s.overrides !== undefined) {
    if (!Array.isArray(s.overrides)) throw bad('来源改写必须是数组');
    for (const o of s.overrides) {
      if (!o || (o.line !== undefined && (!Number.isSafeInteger(o.line) || o.line < 1))) throw bad('来源改写行号不合法');
      const action = o.override?.action;
      const appends = !!action && typeof action === 'object' && 'append' in action;
      checkRuleSetOverrides([{ ...(appends ? {} : { match: o.match ?? '__legacy__' }), override: o.override }]);
    }
  }
  return s;
}
export function ruleConversionRoutes(store: Store, snapshots: SnapshotService, renderer: RenderService) {
  const app = new Hono<ApiEnv>();
  const converter = new RuleConverter();
  const getter = new RuleSourceService(snapshots, converter);
  for (const path of ['/rulesets/preview', '/rulesets/source', '/rules/convert', '/rulesets/:id/sources/:source/content']) {
    app.use(path, (c, next) => path === '/rules/convert' && c.req.method === 'GET' && c.req.query('token') ? next() : requireUser(c, next));
    app.use(path, bodyLimit({ maxSize: 16 * 1024 * 1024 }));
  }
  const own = (id: unknown, userId: string): RuleSetDoc | undefined => {
    if (id === undefined) return undefined;
    if (typeof id !== 'string') throw bad('规则集 id 不合法');
    const row = store.getWithOwner('ruleset', id);
    if (!row || row.owner !== userId) throw notFound('规则集');
    return row.doc;
  };
  app.get('/rulesets/:id/sources/:source/content', async c => {
    const saved = own(c.req.param('id'), c.get('user').id)!;
    const src = saved.sources.find(s => s.id === c.req.param('source'));
    if (!src) throw notFound('来源');
    return c.json(await getter.get(c.get('user').id, src, saved));
  });
  // 草稿包含未保存的正文和参数，因此使用 POST；与 GET 共用 getter。
  app.post('/rulesets/source', async c => {
    const body = await jsonBody<{ id?: unknown; source?: unknown; refresh?: unknown }>(c);
    const saved = own(body.id, c.get('user').id);
    if (body.refresh !== undefined && typeof body.refresh !== 'boolean') throw bad('refresh 必须是布尔值');
    const src = source(body.source);
    checkRepositorySource(src, saved?.sources.find(s => s.id === src.id), store, '来源');
    return c.json(await getter.get(c.get('user').id, src, saved, body.refresh === true));
  });
  // 兼容旧调用方：仅编排 getter 与 converter，不再维护第二套解析/转换实现。
  app.post('/rulesets/preview', async c => {
    const body = await jsonBody<{ id?: unknown; ruleset?: RuleSetDoc; source?: string; client?: string; platform?: string }>(c);
    const saved = own(body.id, c.get('user').id);
    if (!body.ruleset || !Array.isArray(body.ruleset.sources)) throw bad('ruleset.sources 必须是数组');
    checkRuleSetOverrides(body.ruleset.overrides);
    const sources = body.ruleset.sources.map(source);
    const loaded: Awaited<ReturnType<RuleSourceService['get']>>[] = [];
    for (const src of sources) {
      checkRepositorySource(src, saved?.sources.find(s => s.id === src.id), store, '来源');
      loaded.push(await getter.get(c.get('user').id, src, saved));
    }
    if (body.source !== undefined && !sources.some(s => s.id === body.source)) throw bad('来源不存在');
    const result = converter.convert(sources.map((src, i) => ({ source: src, content: loaded[i]!.content })),
      { overrides: body.ruleset.overrides },
      { client: body.client === 'surge' ? 'surge' : 'mihomo', platform: body.platform } as ClientCtx, body.source);
    const stats = result.stats;
    return c.json({ ...result, sources: loaded.map(x => x.status), total: result.lines.length,
      stats: body.source ? undefined : { domain: stats.domain, classical: stats.classical, ipcidr: stats.ipcidr, total: stats.output + stats.duplicates + stats.unsupported, duplicates: stats.duplicates },
      rejected: result.diagnostics.filter(d => d.kind === 'invalid' || d.kind === 'unimplemented'),
      dropped: result.diagnostics.filter(d => d.kind === 'client').map(d => ({ rule: d.text, reason: d.reason })),
      notes: result.diagnostics.filter(d => d.kind === 'degraded').map(d => d.reason),
    });
  });
  // GET 供 URL 嵌套下载使用；登录会话可转换任意外部 URL，订阅 token 只允许自己的已生成资源。
  app.get('/rules/convert', async c => {
    let matcher: ReturnType<typeof remoteRuleMatcher>;
    try { matcher = remoteRuleMatcher(c.req.query('url') ?? ''); }
    catch (error) { throw bad(error instanceof Error ? error.message : String(error)); }
    const url = matcher.remote!.url;
    const client = c.req.query('target') ?? 'mihomo';
    const platform = c.req.query('platform');
    if (!['mihomo', 'surge'].includes(client) || (platform && !['android', 'macos', 'windows', 'ios', 'linux'].includes(platform))) throw bad('客户端或平台不合法');
    if (c.req.query('format') && c.req.query('format') !== 'list') throw bad('URL 转换仅输出 list');
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    const send = (body: string) => {
      c.header('content-disposition', 'attachment; filename="rules.list"');
      return c.text(body);
    };
    const token = c.req.query('token');
    if (token) {
      const active = store.getActiveToken(token);
      if (!active || client !== 'mihomo') throw notFound();
      const key = c.req.query('key');
      const version = c.req.query('v');
      if (!key || !version) throw bad('订阅转换链接缺少资源键或版本');
      const target = { client: 'mihomo' as const, ...(platform ? { platform: platform as Platform } : {}) };
      const retained = renderer.getVersion(active.profileId, target, version);
      // 在发起任何刷新之前检查 URL 与版本归属，防止把订阅链接用成任意地址代理。
      if (!retained || retained.remoteRuleUrls?.[key] !== url) throw notFound();
      await renderer.render(active.profileId, target);
      const selected = renderer.getVersion(active.profileId, target, version) ?? retained;
      const body = selected.rulesets[key];
      if (selected.remoteRuleUrls?.[key] !== url || body === undefined) throw notFound();
      return send(body);
    }
    const src: RuleSetSourceDoc = { id: 'remote', kind: 'remote', url, format: 'auto' };
    const loaded = await getter.get(c.get('user').id, src);
    if (loaded.content === undefined || loaded.status.error) throw new HttpError(502, loaded.status.error ?? '远程规则读取失败');
    const converted = converter.convert([{ source: src, content: loaded.content }], {}, { client, platform } as ClientCtx);
    if (!converted.stats.output) throw bad('远程来源没有可转换的规则', converted.diagnostics.slice(0, 20));
    c.header('x-rule-count', String(converted.stats.output));
    c.header('x-rule-rejected', String(converted.stats.rejected + converted.stats.unsupported));
    return send(converted.lines.join('\n') + '\n');
  });
  app.post('/rules/convert', async c => {
    const body = await jsonBody<{ inputs?: unknown; overrides?: RuleSetDoc['overrides']; noResolve?: boolean; client?: string; platform?: string; sourceId?: string }>(c);
    if (!Array.isArray(body.inputs) || body.inputs.length > 256) throw bad('inputs 必须是数组且不超过 256 个来源');
    if (!['mihomo', 'surge'].includes(body.client ?? '') || (body.platform !== undefined && !['android', 'macos', 'windows', 'ios', 'linux'].includes(body.platform))) throw bad('客户端或平台不合法');
    if (body.noResolve !== undefined && typeof body.noResolve !== 'boolean') throw bad('noResolve 必须是布尔值');
    checkRuleSetOverrides(body.overrides);
    const ids = new Set<string>();
    const inputs: ConversionInput[] = body.inputs.map(i => {
      if (!i || typeof i !== 'object' || (i.content !== undefined && typeof i.content !== 'string')) throw bad('转换输入格式错误');
      const src = source(i.source);
      if (ids.has(src.id)) throw bad('来源 id 重复'); ids.add(src.id);
      return { source: src, content: i.content };
    });
    if (body.sourceId !== undefined && !ids.has(body.sourceId)) throw bad('预览来源不存在');
    if (inputs.some(i => (body.sourceId ? i.source.id === body.sourceId : i.source.enabled !== false) && !['mrs', 'srs'].includes(i.source.format) && i.content === undefined)) throw bad('来源正文尚未读取成功，请先重新读取来源');
    return c.json(converter.convert(inputs, { overrides: body.overrides }, { client: body.client, platform: body.platform } as ClientCtx, body.sourceId));
  });
  return app;
}
