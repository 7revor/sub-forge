import { Hono } from 'hono';
import type { Store } from '../store.ts';
import type { RuleRepoService } from '../rule-repos/service.ts';
import { bad, HttpError, jsonBody, requireAdmin, requireUser, type ApiEnv } from './common.ts';

export function ruleRepoRoutes(store: Store, repos: RuleRepoService) {
  const app = new Hono<ApiEnv>();
  app.use('/rule-repos/*', requireUser);
  app.get('/rule-repos', requireUser, c => { repos.refreshIfDue(); return c.json({ repos: repos.list() }); });
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
    const referrers = store.listTemplates().filter(t => t.rules.some(r => r.matcher.kind === 'ruleset' && r.matcher.repository?.repo === id)).map(t => `模板「${t.name}」`);
    for (const p of store.list('profile')) {
      const rules = p.routing.mode === 'independent' ? p.routing.config.rules : [...(p.routing.prependRules ?? []), ...(p.routing.appendRules ?? [])];
      if (rules.some(rule => rule.matcher.kind === 'ruleset' && rule.matcher.repository?.repo === id)) referrers.push(`配置订阅「${p.name}」`);
    }
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
  return app;
}
