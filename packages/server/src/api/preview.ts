// 编辑器用的预览接口：
//   POST /api/sources/:id/refresh            立即拉取（SRC-03 快照）
//   GET  /api/sources/:id/snapshots          快照历史（不含正文）
//   POST /api/{sources,collections}/:id/pipeline-preview   处理链逐步预览（SRC-06），可带未保存的处理链
//   GET  /api/nodesets/:type/:id/nodes      已保存处理链之后的节点列表
//   POST /api/rulesets/:id/preview           规则集按客户端 + 平台的最终输出（CR-05）

import {
  composeRule, expandRuleSet, lowerRule, NodeSetResolver, parseContent, parseRuleSetContent, Report, runPipeline,
  type Client, type NodeSetID, type OperatorStep, type Platform, type ProxyIR,
} from '@sub-forge/core';
import { Hono, type Context } from 'hono';
import type { SourceDoc } from '../docs.ts';
import type { RenderService } from '../render.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { Store } from '../store.ts';
import { bad, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];
/** 逐步预览每步最多返回的节点数，避免大订阅撑爆响应 */
const MAX_NODES_PER_STEP = 500;
/** 节点选择器最多返回的节点数 */
const MAX_NODE_LIST_SIZE = 5000;

const brief = (n: ProxyIR) => ({ name: n.name, type: n.type, server: n.server, port: n.port });

export function previewRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();
  app.use('/sources/:id/*', requireUser);
  app.use('/collections/:id/*', requireUser);
  app.use('/rulesets/:id/*', requireUser);
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
    if (src.kind !== 'remote') return c.json({ items: [] });
    const items = [];
    for (const url of src.urls ?? []) {
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
   */
  const pipelinePreview = (kind: 'source' | 'collection') => async (c: Context<ApiEnv>) => {
    const user = c.get('user');
    const doc = own(kind, c.req.param('id') ?? '', user.id);
    const body = await jsonBody<{ pipeline?: unknown }>(c);
    let steps: OperatorStep[] = doc.pipeline;
    if (body.pipeline !== undefined) {
      // 借用保存前校验检查草稿处理链（正则、脚本权限）
      steps = validateDoc(kind, { ...(doc as unknown as Record<string, unknown>), pipeline: body.pipeline }, doc.id, user, store).pipeline;
    }

    const ref: NodeSetID = { type: kind, id: doc.id };
    const loaded = await renderer.loadNodeSets([ref]);
    const report = new Report();
    let input: ProxyIR[];
    let failures: { line: string; reason: string }[] = [];
    if (kind === 'source') {
      const src = doc as SourceDoc;
      const bodies = src.kind === 'local' ? [src.content ?? ''] : loaded.inputs.snapshots[doc.id] ?? [];
      input = [];
      for (const b of bodies) {
        const r = parseContent(b, ref);
        input.push(...r.proxies);
        failures = failures.concat(r.failures);
      }
    } else {
      // 组合：成员各自跑完处理链后合并，再逐步执行组合自身的处理链
      const col = loaded.inputs.collections[doc.id]!;
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

  app.post('/rulesets/:id/preview', async (c) => {
    const rs = own('ruleset', c.req.param('id'), c.get('user').id);
    const body = await jsonBody<{ client?: unknown; platform?: unknown }>(c);
    const client: Client = body.client === 'surge' ? 'surge' : 'mihomo';
    const platform = PLATFORMS.find((p) => p === body.platform);
    const ctx = platform ? { client, platform } : { client };

    let content: string | undefined = rs.kind === 'local' ? rs.content ?? '' : undefined;
    let fetchError: string | undefined;
    if (rs.kind === 'remote' && rs.url && rs.format !== 'mrs' && rs.format !== 'srs') {
      const r = await snapshots.get('ruleset', rs.id, rs.url, { ttlSec: rs.fetch?.ttlSec ?? 86400, ...rs.fetch });
      content = r.snapshot?.body;
      fetchError = r.error;
    }
    if (content === undefined) return c.json({ passthrough: rs.format === 'mrs' || rs.format === 'srs', lines: [], dropped: [], rejected: [], ...(fetchError ? { error: fetchError } : {}) });

    const parsed = parseRuleSetContent(content, rs.format);
    const report = new Report();
    const expanded = expandRuleSet(rs.id, { rulesets: { [rs.id]: rs }, bundles: {}, snapshots: { [rs.id]: content } }, ctx, report);
    const lines: string[] = [];
    const dropped: { rule: string; reason: string }[] = [];
    const notes: string[] = [];
    if (!expanded.passthrough) {
      for (const rule of expanded.rules) {
        const l = lowerRule(rule, ctx);
        if (l.kind === 'drop') dropped.push({ rule: JSON.stringify(rule), reason: l.reason });
        else { lines.push(composeRule(l)); if (l.note) notes.push(l.note); }
      }
    }
    return c.json({
      passthrough: expanded.passthrough,
      lines, dropped, notes,
      rejected: parsed.passthrough ? [] : parsed.rejected,
      ...(fetchError ? { error: fetchError } : {}),
    });
  });

  return app;
}
