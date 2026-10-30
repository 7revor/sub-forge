import { profileEditorOverlay } from '@sub-forge/core';
import type { ResourceService } from '../resources.ts';
import { Hono } from 'hono';
import { randomId } from '../crypto.ts';
import type { Store } from '../store.ts';
import type { RuleRepoService } from '../rule-repos/service.ts';
import { bad, HttpError, isStr, jsonBody, notFound, requireAdmin, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

export function ruleRepoRoutes(store: Store, repos: RuleRepoService, resources?:ResourceService) {
  const app = new Hono<ApiEnv>();
  app.use('/rule-repos/*', requireUser);
  app.get('/rule-repos', requireUser, c => c.json({ repos: repos.list() }));
  app.get('/rule-repos/search', c => {
    const { q = '', repo, client, view, offset = '0', limit = '50' } = c.req.query();
    if (q.length > 200) throw bad('关键词最多 200 个字符');
    if (client && client !== 'mihomo' && client !== 'surge') throw bad('客户端筛选不合法');
    if (!/^\d+$/.test(offset) || !/^\d+$/.test(limit) || !Number.isSafeInteger(Number(offset)) || Number(limit) < 1 || Number(limit) > 100) throw bad('分页参数不合法');
    if (view !== undefined && view !== 'files') throw bad('搜索视图不合法');
    return c.json(view === 'files' ? repos.searchFiles(q, repo, client, Number(offset), Number(limit)) : repos.search(q, repo, client, Number(offset), Number(limit)));
  });
  app.get('/rule-repos/entry', async c => {
    const { repo, path } = c.req.query();
    if (!repo || !path) throw bad('缺少 repo 或 path');
    try { return c.json({ item: await repos.detail(repo, path) }); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `规则详情拉取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  app.get('/rule-repos/file-preview', async c => {
    const { repo, ref, path } = c.req.query();
    if (!repo || !ref || !path) throw bad('缺少 repo、ref 或 path');
    try { return c.json({ item: await repos.filePreview(repo, ref, path) }); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `文件内容读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  app.post('/rule-repos/file-refresh', async c=>{
    const body=await jsonBody(c);
    if(!resources || !isStr(body.repo) || !isStr(body.ref) || !isStr(body.path))throw bad('缺少仓库文件标识');
    const resource=repos.fileResource(body.repo,body.ref,body.path);
    return c.json({job:resources.startJob(c.get('user').id,'repository-file',resource.id,[resource])},202);
  });
  app.get('/rule-repos/files', c => {
    const { repo, path } = c.req.query();
    if (!repo || !path) throw bad('缺少 repo 或 path');
    return c.json({ item: repos.fileList(repo, path) });
  });
  app.post('/rule-repos', requireAdmin, async c => {
    const id = await repos.addCustom(await jsonBody(c));
    void repos.refresh(id);
    return c.json({ id, repos: repos.list() }, 201);
  });
  app.put('/rule-repos/:id', requireAdmin, async c => {
    const id = c.req.param('id');
    await repos.update(id, await jsonBody(c));
    if (repos.list().find(r => r.id === id)?.enabled) void repos.refresh(id);
    return c.json({ repos: repos.list() });
  });
  app.delete('/rule-repos/:id', requireAdmin, async c => {
    const id = c.req.param('id');
    const referrers = store.listLatestTemplates().filter(t => t.rules.some(r => r.matcher.kind === 'ruleset' && r.matcher.repository?.repo === id)).map(t => `模板「${t.name}」`);
    for (const p of store.list('profile')) if ((profileEditorOverlay(p).extraRules ?? []).some(({ rule: r }) => r.matcher.kind === 'ruleset' && r.matcher.repository?.repo === id)) referrers.push(`配置订阅「${p.name}」`);
    if (referrers.length) throw new HttpError(409, `仓库仍被引用，不能删除：${referrers.join('、')}`, { referrers });
    await repos.removeCustom(id);
    return c.json({ ok: true });
  });
  app.post('/rule-repos/:id/refresh', requireAdmin, c => {
    void repos.refresh(c.req.param('id'));
    return c.json({ repos: repos.list() }, 202);
  });
  app.patch('/rule-repos/:id', requireAdmin, async c => {
    const body = await jsonBody(c);
    if (typeof body.enabled !== 'boolean') throw bad('enabled 必须是布尔值');
    repos.setEnabled(c.req.param('id'), body.enabled);
    if (body.enabled) void repos.refresh(c.req.param('id'));
    return c.json({ repos: repos.list() });
  });
  // 仅解析关联来源，编辑页保存前不写规则集。
  app.post('/rule-repos/resolve', async c => {
    const body = await jsonBody(c);
    if (!isStr(body.repo) || !isStr(body.path)) throw bad('缺少 repo 或 path');
    if (body.variant !== undefined && !isStr(body.variant)) throw bad('variant 必须是字符串');
    try {
      const result = await repos.linkedSources(body.repo, body.path, body.variant as string | undefined);
      return c.json({ ...result, sources: result.sources.map(s => ({ ...s, id: randomId(9) })) });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `规则关联解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  app.post('/rule-repos/import', async c => {
    const body = await jsonBody(c);
    if (!isStr(body.repo) || !isStr(body.path)) throw bad('缺少 repo 或 path');
    if (body.variant !== undefined && !isStr(body.variant)) throw bad('variant 必须是字符串');
    if (body.ruleset !== undefined && !isStr(body.ruleset)) throw bad('ruleset 必须是字符串');
    let file: { ref: string; path: string } | undefined;
    if (body.file !== undefined) {
      const value = body.file as Record<string, unknown> | null;
      if (!value || typeof value !== 'object' || !isStr(value.ref) || !isStr(value.path)) throw bad('file 必须包含 ref 和 path');
      if (body.variant !== undefined) throw bad('file 与 variant 不可同时指定');
      file = { ref: value.ref, path: value.path };
    }
    const user = c.get('user');
    // 网络请求前校验归属，写入时再次读取最新版本，避免覆盖拉取期间的编辑。
    const loadTarget = () => {
      if (!body.ruleset) return undefined;
      const row = store.getWithOwner('ruleset', body.ruleset as string);
      if (!row || row.owner !== user.id) throw notFound('规则集');
      return row.doc;
    };
    loadTarget();
    let entry;
    try { entry = file ? await repos.linkedFileSource(body.repo, body.path, file) : await repos.linkedSources(body.repo, body.path, body.variant as string | undefined); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `规则文件读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const target = loadTarget();
    const sources = [...(target?.sources ?? [])];
    for (const source of entry.sources) {
      if (sources.some(s => s.kind === 'remote' && s.url === source.url)) continue;
      sources.push({ ...source, id: randomId(9) });
    }
    const id = target?.id ?? randomId(9);
    const doc = validateDoc('ruleset', { ...(target ?? { name: entry.name }), sources }, id, user, store);
    store.put('ruleset', doc, user.id);
    return c.json({ item: doc }, target ? 200 : 201);
  });
  return app;
}
