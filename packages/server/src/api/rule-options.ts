import { Hono } from 'hono';
import { stableHash, type RuleSetSource } from '@sub-forge/core';
import type { RuleRepoService } from '../rule-repos/service.ts';
import type { Store } from '../store.ts';
import { repositoryMatcher } from '../ruleset-reference.ts';
import { bad, HttpError, isStr, jsonBody, requireUser, type ApiEnv } from './common.ts';
import { RefChecker } from './validate.ts';

import { searchRuleOptions } from '../rule-repos/options.ts';

/** 本地与已启用仓库合并排序、分页，避免客户端拼接两套分页时遗漏候选。 */
export function ruleOptionRoutes(store: Store, repos: RuleRepoService) {
  const app = new Hono<ApiEnv>();
  app.use('/rule-options/*', requireUser);
  app.get('/rule-options/locals', c => {
    const refs = new RefChecker(store, c.get('user'));
    return c.json({ items: store.list('ruleset').filter(rs => refs.ruleVisible(rs.id)).map(({ id, name }) => ({ id, name })) });
  });
  app.get('/rule-options/search', c => {
    const { q = '', offset = '0', limit = '30', scope = 'all' } = c.req.query();
    if (q.length > 200 || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || !['all', 'repository'].includes(scope)) throw bad('规则集搜索参数不合法');
    const refs = new RefChecker(store, c.get('user'));
    const local = scope === 'repository' ? [] : store.list('ruleset').filter(rs => refs.ruleVisible(rs.id)).map(rs => ({
      id: rs.id, name: rs.name, hint: `本地规则集 · ${rs.note || `${rs.sources.length} 个来源`}`,
    }));
    const notices = repos.list().filter(r => r.enabled).flatMap(r => {
      if (r.error || !r.builtAt) return [`${r.name}：${r.error ? '索引更新失败' : '索引尚未就绪'}${r.entries ? '，使用已有索引' : ''}`];
      return store.db.prepare('SELECT 1 FROM rule_repo_catalog WHERE repo = ?').get(r.id) ? [] : [`${r.name}：完整文件索引待更新`];
    });
    return c.json({ ...searchRuleOptions(store.db, local, q, Number(offset), Number(limit)), notices });
  });
  app.post('/rule-options/resolve', async c => {
    const body = await jsonBody(c);
    const user = c.get('user');
    if (body.source === 'local') {
      if (!isStr(body.id) || !new RefChecker(store, user).ruleVisible(body.id)) throw bad('本地规则集不可用');
      return c.json({ matcher: { kind: 'ruleset', id: body.id } });
    }
    if (body.source !== 'repository' || !isStr(body.repo) || !isStr(body.entry)) throw bad('请选择规则集');
    let file: { ref: string; path: string } | undefined;
    if (body.file !== undefined) {
      const value = body.file as Record<string, unknown> | null;
      if (!value || typeof value !== 'object' || !isStr(value.ref) || !isStr(value.path)) throw bad('file 必须包含 ref 和 path');
      file = { ref: value.ref, path: value.path };
    }
    try {
      const result = file ? await repos.linkedFileSource(body.repo, body.entry, file) : await repos.linkedSources(body.repo, body.entry);
      const sources: RuleSetSource[] = result.sources.map(s => ({ ...s, id: `file-${stableHash(JSON.stringify(s.repository))}`, format: 'auto' }));
      const name = `${repos.list().find(r => r.id === body.repo)?.name ?? body.repo} · ${file ? `${file.path} · ${file.ref}` : result.name}`;
      return c.json({ matcher: repositoryMatcher({ repo: body.repo, entry: body.entry, name, sources }) });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `规则集解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return app;
}
