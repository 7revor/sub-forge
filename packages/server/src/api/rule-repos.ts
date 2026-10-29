import { Hono } from 'hono';
import { randomId } from '../crypto.ts';
import type { Store } from '../store.ts';
import type { RuleRepoService } from '../rule-repos/service.ts';
import { rawUrl } from '../rule-repos/adapters.ts';
import { bad, HttpError, isStr, jsonBody, notFound, requireAdmin, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

export function ruleRepoRoutes(store: Store, repos: RuleRepoService) {
  const app = new Hono<ApiEnv>();
  app.use('/rule-repos/*', requireUser);
  app.get('/rule-repos', requireUser, c => c.json({ repos: repos.list() }));
  app.get('/rule-repos/search', c => {
    const { q = '', repo, client, offset = '0', limit = '50' } = c.req.query();
    if (q.length > 200) throw bad('关键词最多 200 个字符');
    if (client && client !== 'mihomo' && client !== 'surge') throw bad('客户端筛选不合法');
    if (!/^\d+$/.test(offset) || !/^\d+$/.test(limit) || !Number.isSafeInteger(Number(offset)) || Number(limit) < 1 || Number(limit) > 100) throw bad('分页参数不合法');
    return c.json(repos.search(q, repo, client, Number(offset), Number(limit)));
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
  app.post('/rule-repos/import', async c => {
    const body = await jsonBody(c);
    if (!isStr(body.repo) || !isStr(body.path)) throw bad('缺少 repo 或 path');
    if (body.variant !== undefined && !isStr(body.variant)) throw bad('variant 必须是字符串');
    if (body.ruleset !== undefined && !isStr(body.ruleset)) throw bad('ruleset 必须是字符串');
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
    try { entry = await repos.resolvedEntry(body.repo, body.path); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `规则使用说明拉取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const variant = repos.importVariant(entry, body.variant as string | undefined);
    const target = loadTarget();
    const sources = [...(target?.sources ?? [])];
    for (const file of variant.files) {
      const url = rawUrl(repos.definition(body.repo), file);
      if (sources.some(s => s.kind === 'remote' && s.url === url)) continue;
      sources.push({ id: randomId(9), kind: 'remote', name: `${body.repo} · ${file.path}`, url, format: file.format, behavior: file.behavior });
    }
    const id = target?.id ?? randomId(9);
    const doc = validateDoc('ruleset', { ...(target ?? { name: entry.name }), sources }, id, user, store);
    store.put('ruleset', doc, user.id);
    return c.json({ item: doc }, target ? 200 : 201);
  });
  return app;
}
