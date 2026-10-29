// 编辑器用的预览接口：
//   POST /api/sources/:id/refresh            立即拉取（SRC-03 快照）
//   GET  /api/sources/:id/snapshots          快照历史（不含正文）
//   POST /api/{sources,collections}/:id/pipeline-preview   处理链逐步预览（SRC-06），支持拉取参数与成员草稿
//   GET  /api/nodesets/:type/:id/nodes      已保存处理链之后的节点列表
//   POST /api/rulesets/preview               规则集草稿按客户端 + 平台的输出（CR-05）：指定来源时为该来源，否则为合并结果

import {
  composeRule, expandRuleSet, expandSource, lowerRule, NodeSetResolver, parseContent, parseRuleSetContent, Report, runPipeline, sourceKey, withIpOptions,
  type Client, type ClientCtx, type Collection, type NodeSetID, type OperatorStep, type Platform, type ProxyIR, type RuleIR,
} from '@sub-forge/core';
import type { RuleSetDoc, RuleSetSourceDoc } from '../docs.ts';
import { Hono, type Context } from 'hono';
import type { RenderService } from '../render.ts';
import type { SourceDoc } from '../docs.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { Store } from '../store.ts';
import { bad, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { checkRuleSetOverrides, validateDoc } from './validate.ts';

const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];
/** 逐步预览每步最多返回的节点数，避免大订阅撑爆响应 */
const MAX_NODES_PER_STEP = 500;
/** 节点选择器最多返回的节点数 */
const MAX_NODE_LIST_SIZE = 5000;
/** 规则集预览最多返回的输出行数 */
const MAX_RULE_LINES = 5000;
/** 未保存草稿的远程来源只拉取不落快照，短时间内复用结果，避免每次按键都去拉 */
const PEEK_TTL_MS = 5 * 60_000;

const brief = (n: ProxyIR) => ({ name: n.name, type: n.type, server: n.server, port: n.port });

export function previewRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();
  app.use('/sources/:id/*', requireUser);
  app.use('/collections/:id/*', requireUser);
  app.use('/rulesets/preview', requireUser);
  app.use('/nodesets/:type/:id/*', requireUser);

  const own = <K extends 'source' | 'collection' | 'local' | 'ruleset'>(kind: K, id: string, userId: string) => {
    const row = store.getWithOwner(kind, id);
    if (!row || row.owner !== userId) throw notFound(kind === 'source' ? '订阅源' : kind === 'collection' ? '组合' : kind === 'local' ? '本地节点组' : '规则集');
    return row.doc;
  };

  app.get('/nodesets/:type/:id/nodes', async (c) => {
    const type = c.req.param('type');
    if (type !== 'source' && type !== 'collection' && type !== 'local') throw bad('type 只能是 source、collection 或 local');
    const doc = own(type, c.req.param('id'), c.get('user').id);
    const ref: NodeSetID = { type, id: doc.id };
    const loaded = await renderer.loadNodeSets([ref]);
    const report = new Report();
    const nodes = new NodeSetResolver(loaded.inputs, report).resolve(ref);
    return c.json({
      nodes: nodes.slice(0, MAX_NODE_LIST_SIZE).map(brief),
      total: nodes.length,
      truncated: nodes.length > MAX_NODE_LIST_SIZE,
      report: [...loaded.report, ...report.items],
    });
  });

  app.post('/sources/:id/refresh', async (c) => {
    const src = own('source', c.req.param('id'), c.get('user').id);
    const items = [];
    for (const url of src.urls) {
      const r = await snapshots.refresh('source', src.id, url, src.fetch ?? {});
      items.push({ url, ok: r.ok, fetchedAt: r.fetchedAt, ...(r.error ? { error: r.error } : {}), ...(r.userinfo ? { userinfo: r.userinfo } : {}) });
    }
    return c.json({ items });
  });

  app.get('/sources/:id/snapshots', (c) => {
    const src = own('source', c.req.param('id'), c.get('user').id);
    return c.json({ items: store.snapshotHistory('source', src.id) });
  });

  /**
   * 处理链逐步预览：输入为订阅源解析结果（或组合合并后的结果），逐步执行请求体里的处理链草稿
   * （缺省用已保存的处理链），返回每一步之后的节点与改名 / 移除差异。
   * 组合可带成员草稿；订阅源可带拉取参数草稿，只读取临时预览，不改正式快照。
   */
  const pipelinePreview = (kind: 'source' | 'collection') => async (c: Context<ApiEnv>) => {
    const user = c.get('user');
    let doc = own(kind, c.req.param('id') ?? '', user.id);
    const saved = doc;
    const body = await jsonBody<{ pipeline?: unknown; members?: unknown; source?: { urls?: unknown; fetch?: unknown } }>(c);
    if (kind === 'source' && body.source !== undefined && (!body.source || typeof body.source !== 'object' || Array.isArray(body.source))) throw bad('订阅源草稿必须是对象');
    if (body.pipeline !== undefined || (kind === 'collection' && body.members !== undefined) || (kind === 'source' && body.source !== undefined)) {
      // 借用保存前校验检查草稿（正则、脚本权限、成员引用与成环）
      const patch = {
        pipeline: body.pipeline ?? doc.pipeline,
        ...(kind === 'collection' && body.members !== undefined ? { members: body.members } : {}),
        ...(kind === 'source' && body.source !== undefined ? { urls: body.source.urls, fetch: body.source.fetch } : {}),
      };
      doc = validateDoc(kind, { ...(doc as unknown as Record<string, unknown>), ...patch }, doc.id, user, store);
    }
    const steps: OperatorStep[] = doc.pipeline;

    const ref: NodeSetID = { type: kind, id: doc.id };
    const sourceChanged = kind === 'source' && JSON.stringify([(doc as SourceDoc).urls, (doc as SourceDoc).fetch ?? {}]) !== JSON.stringify([(saved as SourceDoc).urls, (saved as SourceDoc).fetch ?? {}]);
    const loaded = sourceChanged ? await renderer.loadNodeSets([])
      : kind === 'collection'
      ? await renderer.loadNodeSets((doc as Collection).members.map((m) => m.ref))
      : await renderer.loadNodeSets([ref]);
    const report = new Report();
    let input: ProxyIR[];
    let failures: { line: string; reason: string }[] = [];
    if (kind === 'source') {
      input = [];
      const bodies: string[] = [];
      if (sourceChanged) {
        const src = doc as SourceDoc;
        const results = await Promise.all(src.urls.map((url) => snapshots.previewSource(src.id, url, src.fetch)));
        for (const result of results) if (result.body !== undefined) bodies.push(result.body);
        for (const [index, result] of results.entries()) if (result.error) {
          report[bodies.length ? 'warn' : 'error']('source.fetch-failed', `地址 ${index + 1} 预览拉取失败：${result.error}`, `source:${src.id}`);
        }
      } else bodies.push(...(loaded.inputs.snapshots[doc.id] ?? []));
      for (const b of bodies) {
        const r = parseContent(b, ref);
        input.push(...r.proxies);
        failures = failures.concat(r.failures);
      }
    } else {
      // 组合：成员各自跑完处理链后合并，再逐步执行组合自身的处理链
      const col = doc as Collection;
      const resolver = new NodeSetResolver({ ...loaded.inputs, collections: { ...loaded.inputs.collections, [doc.id]: { ...col, pipeline: [] } } }, report);
      input = resolver.resolve(ref);
    }
    const result = runPipeline(input, steps, { keepSnapshots: true });
    return c.json({
      input: input.length,
      failures,
      report: [...loaded.report, ...report.items],
      inputNodes: input.slice(0, MAX_NODES_PER_STEP).map(brief),
      trace: result.trace.map(({ nodes, origins, ...t }) => ({
        ...t,
        nodes: (nodes ?? []).slice(0, MAX_NODES_PER_STEP).map(brief),
        origins: (origins ?? []).slice(0, MAX_NODES_PER_STEP),
        truncated: (nodes?.length ?? 0) > MAX_NODES_PER_STEP,
      })),
      nodes: result.nodes.slice(0, MAX_NODES_PER_STEP).map(brief),
    });
  };
  app.post('/sources/:id/pipeline-preview', pipelinePreview('source'));
  app.post('/collections/:id/pipeline-preview', pipelinePreview('collection'));

  const peeked = new Map<string, { at: number; result: { body?: string; error?: string } }>();
  const peek = async (src: RuleSetSourceDoc) => {
    const key = `${src.format}\u0000${src.url}`;
    const hit = peeked.get(key);
    if (hit && Date.now() - hit.at < PEEK_TTL_MS) return hit.result;
    const result = await snapshots.peek(src.url!, { ...src.fetch, format: src.format });
    peeked.set(key, { at: Date.now(), result });
    while (peeked.size > 64) peeked.delete(peeked.keys().next().value!);
    return result;
  };

  const lower = (rules: RuleIR[], ctx: ClientCtx) => {
    const lines: string[] = [];
    const dropped: { rule: string; reason: string }[] = [];
    const notes: string[] = [];
    for (const rule of rules) {
      const l = lowerRule(rule, ctx);
      if (l.kind === 'drop') dropped.push({ rule: JSON.stringify(rule), reason: l.reason });
      else { lines.push(composeRule(l)); if (l.note) notes.push(l.note); }
    }
    return { lines, dropped, notes };
  };

  /**
   * 规则集预览：请求体带编辑中的草稿（可未保存），不写入任何文档。
   * - id：已保存的规则集，已保存的远程地址读写它名下的快照；其余地址（新建草稿、编辑中新填的）只拉取不落快照；
   * - source：来源 id，给出时返回该来源的输出与无法解析的行，否则返回全部启用来源合并（去重、按 behavior 排序）后的结果；
   * - 每个来源的拉取状态一并返回，界面在来源列表上标出。
   */
  app.post('/rulesets/preview', async (c) => {
    const user = c.get('user');
    const body = await jsonBody<{ ruleset?: unknown; id?: unknown; source?: unknown; client?: unknown; platform?: unknown }>(c);
    const client: Client = body.client === 'surge' ? 'surge' : 'mihomo';
    const platform = PLATFORMS.find((p) => p === body.platform);
    const ctx: ClientCtx = platform ? { client, platform } : { client };
    const saved = typeof body.id === 'string' && body.id ? own('ruleset', body.id, user.id) : undefined;
    const savedId = saved?.id;
    // 只有已保存的地址读写快照；编辑中尚未保存的地址（含输入到一半的）只拉取，不在快照表里留下记录
    const savedUrls = new Set((saved?.sources ?? []).flatMap((x) => (x.kind === 'remote' && x.url ? [x.url] : [])));
    const draft = body.ruleset as Partial<RuleSetDoc> | undefined;
    if (!draft || typeof draft !== 'object' || !Array.isArray(draft.sources)) throw bad('ruleset.sources 必须是数组');
    checkRuleSetOverrides(draft.overrides);
    const rs: RuleSetDoc = { id: savedId ?? 'draft', name: typeof draft.name === 'string' && draft.name ? draft.name : '未命名', sources: draft.sources, ...(draft.overrides ? { overrides: draft.overrides } : {}), ...(draft.noResolve ? { noResolve: true } : {}) };

    const snapshotsIn: Record<string, string> = {};
    const status: { id: string; ok: boolean; error?: string; fetchedAt?: number; passthrough?: boolean; rules?: number; rejected?: number }[] = [];
    for (const src of rs.sources) {
      if (!src || typeof src !== 'object' || typeof src.id !== 'string') throw bad('来源格式错误');
      const passthrough = src.format === 'mrs' || src.format === 'srs';
      let content = src.kind === 'local' ? src.content ?? '' : undefined;
      let error: string | undefined;
      let fetchedAt: number | undefined;
      if (src.kind === 'remote' && !passthrough && (body.source === undefined || body.source === src.id || src.enabled !== false)) {
        if (!src.url || !/^https?:\/\/[^/]+/.test(src.url)) error = '请填写 http(s) 地址';
        else if (savedId && savedUrls.has(src.url)) {
          const r = await snapshots.get('ruleset', savedId, src.url, { ttlSec: src.fetch?.ttlSec ?? 86400, ...src.fetch, format: src.format });
          content = r.snapshot?.body;
          fetchedAt = r.snapshot?.fetchedAt;
          error = r.error;
        } else {
          const r = await peek(src);
          content = r.body;
          error = r.error;
        }
      }
      if (content !== undefined && src.kind === 'remote') snapshotsIn[sourceKey(rs.id, src.id)] = content;
      const parsed = content === undefined || passthrough ? undefined : parseRuleSetContent(content, src.format, src.behavior);
      status.push({
        id: src.id, ok: !error && (passthrough || content !== undefined),
        ...(error ? { error } : {}), ...(fetchedAt ? { fetchedAt } : {}), ...(passthrough ? { passthrough: true } : {}),
        ...(parsed && !parsed.passthrough ? { rules: parsed.rules.length, rejected: parsed.rejected.length } : {}),
      });
    }
    const inputs = { rulesets: { [rs.id]: rs }, snapshots: snapshotsIn };
    const report = new Report();

    if (body.source !== undefined) {
      const src = rs.sources.find((x) => x.id === body.source);
      if (!src) throw bad('来源不存在');
      const st = status.find((x) => x.id === src.id)!;
      if (src.format === 'mrs' || src.format === 'srs') return c.json({ sources: status, passthrough: true, lines: [], dropped: [], notes: [], rejected: [] });
      const content = src.kind === 'local' ? src.content ?? '' : snapshotsIn[sourceKey(rs.id, src.id)];
      if (content === undefined) return c.json({ sources: status, passthrough: false, lines: [], dropped: [], notes: [], rejected: [], ...(st.error ? { error: st.error } : {}) });
      const parsed = parseRuleSetContent(content, src.format, src.behavior);
      const ex = expandSource(rs, src, inputs, ctx, report);
      const out = ex.passthrough ? { lines: [], dropped: [], notes: [] } : lower(ex.rules.map((r) => withIpOptions(r, { noResolve: rs.noResolve })), ctx);
      return c.json({
        sources: status, passthrough: ex.passthrough,
        ...out, lines: out.lines.slice(0, MAX_RULE_LINES), total: out.lines.length,
        rejected: parsed.passthrough ? [] : parsed.rejected,
        ...(st.error ? { error: st.error } : {}),
      });
    }

    // 合并结果：只合并已拿到内容的来源；拉取失败的来源在 sources 里标红，不阻断预览
    const usable: RuleSetDoc = { ...rs, sources: rs.sources.filter((s) => s.kind === 'local' || s.format === 'mrs' || s.format === 'srs' || snapshotsIn[sourceKey(rs.id, s.id)] !== undefined) };
    const b = expandRuleSet(rs.id, { ...inputs, rulesets: { [rs.id]: usable } }, ctx, report);
    const out = lower([...b.domain, ...b.classical, ...b.ipcidr], ctx);
    return c.json({
      sources: status, passthrough: false,
      ...out, lines: out.lines.slice(0, MAX_RULE_LINES), total: out.lines.length,
      rejected: [],
      stats: { domain: b.domain.length, classical: b.classical.length, ipcidr: b.ipcidr.length, total: b.total, duplicates: b.duplicates },
      passthroughSources: b.passthrough.map(({ sourceId, name, format }) => ({ sourceId, name, format })),
    });
  });

  return app;
}
