// 编辑器用的预览接口：
//   POST /api/sources/:id/refresh            立即拉取（SRC-03 快照）
//   GET  /api/sources/:id/snapshots          快照历史（不含正文）
//   POST /api/{sources,collections}/:id/pipeline-preview   处理链逐步预览（SRC-06），支持拉取参数与成员草稿
//   GET  /api/nodesets/:type/:id/nodes      已保存处理链之后的节点列表

import {
  compileUserRegex, matchesNameSearch, NodeSetResolver, parseContent, Report, runPipeline,
  type Collection, type NodeSetID, type OperatorStep, type ProxyIR,
} from '@sub-forge/core';
import { Hono, type Context } from 'hono';
import type { RenderService } from '../render.ts';
import type { SourceDoc } from '../docs.ts';
import type { SnapshotService } from '../snapshots.ts';
import { sourceUrl } from '../source-url.ts';
import type { Store } from '../store.ts';
import { bad, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

/** 逐步预览每步最多返回的节点数，避免大订阅撑爆响应 */
const MAX_NODES_PER_STEP = 500;
/** 节点选择器最多返回的节点数 */
const MAX_NODE_LIST_SIZE = 5000;
const brief = (n: ProxyIR) => ({ name: n.name, type: n.type, server: n.server, port: n.port });

export function previewRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();
  app.use('/sources/:id/*', requireUser);
  app.use('/collections/:id/*', requireUser);
  app.use('/nodesets/:type/:id/*', requireUser);

  const own = <K extends 'source' | 'collection' | 'local' | 'ruleset'>(kind: K, id: string, userId: string) => {
    const row = store.getWithOwner(kind, id);
    if (!row || row.owner !== userId) throw notFound(kind === 'source' ? '订阅源' : kind === 'collection' ? '组合' : kind === 'local' ? '本地节点组' : '规则集');
    return row.doc;
  };

  app.get('/nodesets/:type/:id/nodes', async (c) => {
    const type = c.req.param('type');
    const query = c.req.query('q') ?? '';
    if (query.length > 200) throw bad('关键词最多 200 个字符');
    if (type !== 'source' && type !== 'collection' && type !== 'local') throw bad('type 只能是 source、collection 或 local');
    const doc = own(type, c.req.param('id'), c.get('user').id);
    const ref: NodeSetID = { type, id: doc.id };
    const filter = c.req.query('filter') ?? '';
    const excludeFilter = c.req.query('excludeFilter') ?? '';
    let include: RegExp | undefined;
    let exclude: RegExp | undefined;
    try {
      if (filter) include = compileUserRegex(filter);
      if (excludeFilter) exclude = compileUserRegex(excludeFilter);
    } catch (error) { throw bad(error instanceof Error ? error.message : String(error)); }
    const loaded = await renderer.loadNodeSets([ref], c.get('user').id);
    const report = new Report();
    const nodes = new NodeSetResolver(loaded.inputs, report).resolve(ref).filter(node => matchesNameSearch(node.name, query));
    // 先在完整列表筛选，再截断展示，避免第 5000 个以后的节点无法被找到。
    const matched = nodes.filter(node => (!include || include.test(node.name)) && (!exclude || !exclude.test(node.name)));
    return c.json({
      nodes: matched.slice(0, MAX_NODE_LIST_SIZE).map(brief),
      total: matched.length,
      ...(filter || excludeFilter ? { unfilteredTotal: nodes.length } : {}),
      truncated: matched.length > MAX_NODE_LIST_SIZE,
      report: [...loaded.report, ...report.items],
    });
  });

  app.post('/sources/:id/refresh', async (c) => {
    const src = own('source', c.req.param('id'), c.get('user').id);
    const r = await snapshots.refresh('source', src.id, src.url, src.fetch ?? {});
    return c.json({ items: [{ url: src.url, ok: r.ok, fetchedAt: r.fetchedAt, ...(r.error ? { error: r.error } : {}), ...(r.userinfo ? { userinfo: r.userinfo } : {}) }] });
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
    const body = await jsonBody<{ pipeline?: unknown; members?: unknown; source?: { url?: unknown; urls?: unknown; fetch?: unknown } }>(c);
    if (kind === 'source' && body.source !== undefined && (!body.source || typeof body.source !== 'object' || Array.isArray(body.source))) throw bad('订阅源草稿必须是对象');
    let url: string | undefined;
    if (kind === 'source' && body.source !== undefined) {
      try { url = sourceUrl(body.source); } catch (e) { throw bad((e as Error).message); }
    }
    if (body.pipeline !== undefined || (kind === 'collection' && body.members !== undefined) || (kind === 'source' && body.source !== undefined)) {
      // 借用保存前校验检查草稿（正则、脚本权限、成员引用与成环）
      const patch = {
        pipeline: body.pipeline ?? doc.pipeline,
        ...(kind === 'collection' && body.members !== undefined ? { members: body.members } : {}),
        ...(kind === 'source' && body.source !== undefined ? { url, fetch: body.source.fetch } : {}),
      };
      doc = validateDoc(kind, { ...(doc as unknown as Record<string, unknown>), ...patch }, doc.id, user, store);
    }
    const steps: OperatorStep[] = doc.pipeline;

    const ref: NodeSetID = { type: kind, id: doc.id };
    const sourceChanged = kind === 'source' && (doc as SourceDoc).url !== (saved as SourceDoc).url;
    const loaded = sourceChanged ? await renderer.loadNodeSets([], user.id)
      : kind === 'collection'
      ? await renderer.loadNodeSets((doc as Collection).members.map((m) => m.ref), user.id)
      : await renderer.loadNodeSets([ref], user.id);
    const report = new Report();
    let input: ProxyIR[];
    let failures: { line: string; reason: string }[] = [];
    if (kind === 'source') {
      input = [];
      const bodies: string[] = [];
      if (sourceChanged) {
        const src = doc as SourceDoc;
        const result = await snapshots.previewSource(src.id, src.url);
        if (result.body !== undefined) bodies.push(result.body);
        if (result.error) report.error('source.fetch-failed', `预览拉取失败：${result.error}`, `source:${src.id}`);
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

  return app;
}
