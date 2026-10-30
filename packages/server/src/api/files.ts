import { Hono } from 'hono';
import { Report, resolveProfileRouting, stableHash, stableStringify, type RuleEntry } from '@sub-forge/core';
import type { Store } from '../store.ts';
import type { SnapshotService } from '../snapshots.ts';
import type { RuleRepoService } from '../rule-repos/service.ts';
import { profileTemplate } from '../profile-routing.ts';
import { resolveRuleSetReference } from '../ruleset-reference.ts';
import { RuleConverter } from '../rule-converter.ts';
import { RuleSourceService } from '../rule-source.ts';
import { HttpError } from './common.ts';

/** 只打开已保存的资源引用，不接受任意上游地址，不为预览新建订阅或私有产物。 */
export function fileRoutes(store: Store, snapshots: SnapshotService, repos: RuleRepoService) {
  const app = new Hono();
  const getter = new RuleSourceService(snapshots, new RuleConverter());
  app.use('/:token/*', async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'no-referrer');
    const token = c.req.param('token')!;
    const user = store.getActiveToken(token);
    if (!user) return c.body(null, 404);
    await next();
    if (store.getActiveToken(token)?.userId !== user.userId) c.res = new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  });
  app.onError((error, c) => {
    const token = c.req.param('token');
    if (!token || !store.getActiveToken(token)) return c.body(null, 404);
    if (error instanceof HttpError) return c.text(error.message, error.status);
    console.error('文件预览失败', error);
    return c.text('文件暂时不可用，请稍后重试', 503);
  });
  app.get('/:token/repository', async c => {
    const { repo, ref, path } = c.req.query();
    if (!repo || !ref || !path) return c.text('缺少仓库文件标识', 400);
    const file = await repos.filePreview(repo, ref, path);
    c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    if (file.cache?.error) c.header('x-sub-forge-warning', 'last-good-source');
    return c.text(file.content);
  });
  app.get('/:token/:kind/:id/rules/:rule', async c => {
    const { kind, id, rule: ruleId, token } = c.req.param();
    const user = store.getActiveToken(token!)!;
    const read = (): RuleEntry | undefined => {
      if (kind === 'templates') return store.getTemplate(id!)?.rules.find(rule => rule.id === ruleId);
      if (kind !== 'profiles') return undefined;
      const row = store.getWithOwner('profile', id!);
      if (!row || row.owner !== user.userId) return undefined;
      const template = profileTemplate(row.doc, (key, version) => store.getTemplate(key, version));
      return resolveProfileRouting(row.doc, template, new Report()).rules.find(rule => rule.id === ruleId);
    };
    const rule = read();
    if (!rule || rule.matcher.kind !== 'ruleset') return c.body(null, 404);
    if (c.req.query('revision') !== stableHash(stableStringify(rule.matcher))) return c.text('规则已修改，请先保存并重新打开文件链接', 409);
    const rs = resolveRuleSetReference(rule.matcher, store);
    if (!rs) return c.body(null, 404);
    const sources = rs.sources.filter(source => source.enabled !== false);
    if (sources.some(source => source.format === 'mrs' || source.format === 'srs')) return c.text('二进制规则无法作为文本展示，请使用对应的规则订阅链接', 415);
    const revision = store.configurationRevision;
    const bodies: string[] = [];
    for (const source of sources) {
      const result = await getter.get(user.userId, source, rs);
      if (!store.getActiveToken(token!) || !read() || !resolveRuleSetReference(rule.matcher, store)) return c.body(null, 404);
      if (store.configurationRevision !== revision) return c.text('读取期间资源发生变化，请重新打开文件链接', 409);
      if (result.content === undefined) return c.text(result.status.error ?? '规则来源暂时不可用', 503);
      if (result.status.error) c.header('x-sub-forge-warning', 'last-good-source');
      bodies.push(result.content);
    }
    c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(rs.name)}.txt`);
    return c.text(bodies.join('\n'));
  });
  return app;
}
