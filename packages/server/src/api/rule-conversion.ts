// 来源获取与无 I/O 转换分别提供接口，客户端切换不会读取上游。
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ClientCtx } from '@sub-forge/core';
import type { RuleSetDoc, RuleSetSourceDoc } from '../docs.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { Store } from '../store.ts';
import { RuleConverter, type ConversionInput } from '../rule-converter.ts';
import { RuleSourceService } from '../rule-source.ts';
import { bad, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
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
export function ruleConversionRoutes(store: Store, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();
  const converter = new RuleConverter();
  const getter = new RuleSourceService(snapshots, converter);
  for (const path of ['/rulesets/preview', '/rulesets/source', '/rules/convert', '/rulesets/:id/sources/:source/content']) {
    app.use(path, requireUser);
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
      { overrides: body.ruleset.overrides, noResolve: body.ruleset.noResolve },
      { client: body.client === 'surge' ? 'surge' : 'mihomo', platform: body.platform } as ClientCtx, body.source);
    const stats = result.stats;
    return c.json({ ...result, sources: loaded.map(x => x.status), total: result.lines.length,
      stats: body.source ? undefined : { domain: stats.domain, classical: stats.classical, ipcidr: stats.ipcidr, total: stats.output + stats.duplicates + stats.unsupported, duplicates: stats.duplicates },
      rejected: result.diagnostics.filter(d => d.kind === 'invalid' || d.kind === 'unimplemented'),
      dropped: result.diagnostics.filter(d => d.kind === 'client').map(d => ({ rule: d.text, reason: d.reason })),
      notes: result.diagnostics.filter(d => d.kind === 'degraded').map(d => d.reason),
    });
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
    return c.json(converter.convert(inputs, { overrides: body.overrides, noResolve: body.noResolve }, { client: body.client, platform: body.platform } as ClientCtx, body.sourceId));
  });
  return app;
}
