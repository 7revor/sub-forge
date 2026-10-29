import { Hono } from 'hono';
import { matchesNameSearch, normalizeNameSearch, stableHash, type RuleSetSource } from '@sub-forge/core';
import type { RuleRepoService } from '../rule-repos/service.ts';
import type { Store } from '../store.ts';
import { repositoryMatcher } from '../ruleset-reference.ts';
import { bad, HttpError, isStr, jsonBody, requireUser, type ApiEnv } from './common.ts';
import { RefChecker } from './validate.ts';

const normalize = normalizeNameSearch;

/** 本地与已启用仓库合并排序、分页，避免客户端拼接两套分页时遗漏候选。 */
export function ruleOptionRoutes(store: Store, repos: RuleRepoService) {
  const app = new Hono<ApiEnv>();
  app.use('/rule-options/*', requireUser);
  app.get('/rule-options/locals', c => {
    const refs = new RefChecker(store, c.get('user'));
    return c.json({ items: store.list('ruleset').filter(rs => refs.ruleVisible(rs.id)).map(({ id, name }) => ({ id, name })) });
  });
  app.get('/rule-options/catalog', c => {
    const { scope = 'all', q: query = '', repo, directory = '', offset = '0', limit = '30' } = c.req.query();
    if (query.length > 200) throw bad('关键词最多 200 个字符');
    if (!['all', 'repository'].includes(scope)) throw bad('规则集作用域不合法');
    if (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) throw bad('分页参数不合法');
    if (directory.length > 4096 || (directory && (!repo || directory.split('/').some(part => !part || part === '.' || part === '..')))) throw bad('目录参数不合法');
    const notices: string[] = [];
    const repositories = repos.list().filter(r => r.enabled);
    const notice = (repository: typeof repositories[number], complete: boolean) => {
      if (repository.error) notices.push(`${repository.name}：索引更新失败，保留已有目录`);
      else if (!complete) notices.push(`${repository.name}：完整目录索引待更新`);
    };
    const page = <T,>(items: T[], total: number) => ({ items, total, offset: Number(offset), limit: Number(limit),
      ...(Number(offset) + items.length < total ? { nextOffset: Number(offset) + items.length } : {}), notices });
    if (repo !== undefined) {
      const repository = repositories.find(item => item.id === repo);
      if (!repository) throw new HttpError(404, '规则仓库不可用');
      const result = repos.catalogPage(repo, matchesNameSearch(repository.name, query) ? '' : query, directory, Number(offset), Number(limit));
      notice(repository, result.complete);
      return c.json(page(result.items, result.total));
    }
    const refs = new RefChecker(store, c.get('user'));
    const locals = scope === 'repository' ? [] : store.list('ruleset').filter(rs => refs.ruleVisible(rs.id) && matchesNameSearch(rs.name, query))
      .map(rs => ({ kind: 'local' as const, id: rs.id, name: rs.name, hint: rs.note || `${rs.sources.length} 个来源` }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
    const remote = repositories.filter(repository => {
      const status = repos.catalogStatus(repository.id, matchesNameSearch(repository.name, query) ? '' : query);
      notice(repository, status.complete);
      return status.matches;
    }).map(repository => ({ kind: 'repository' as const, repo: repository.id, name: repository.name }));
    const items = [...locals, ...remote];
    return c.json(page(items.slice(Number(offset), Number(offset) + Number(limit)), items.length));
  });
  app.get('/rule-options/search', c => {
    const { q = '', offset = '0', limit = '30', scope = 'all' } = c.req.query();
    if (q.length > 200 || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || !['all', 'repository'].includes(scope)) throw bad('规则集搜索参数不合法');
    const query = normalize(q);
    const refs = new RefChecker(store, c.get('user'));
    const repositories = repos.list();
    const names = new Map(repositories.map(r => [r.id, r.name]));
    const local = scope === 'repository' ? [] : store.list('ruleset').filter(rs => refs.ruleVisible(rs.id)).map(rs => ({
      key: JSON.stringify(['local', rs.id]), name: rs.name, label: `本地 · ${rs.name}`, hint: rs.note || `${rs.sources.length} 个来源`, search: `${rs.name} ${rs.note ?? ''}`,
    }));
    const remote = repos.searchFiles('', undefined, undefined, 0, Number.MAX_SAFE_INTEGER).items.map(rs => ({
      key: JSON.stringify(['repository', rs.repo, rs.path, rs.ref, rs.filePath]), name: rs.name.replace(/\.[^.]+$/, ''), label: rs.name,
      hint: `${names.get(rs.repo) ?? rs.repo} · ${rs.filePath} · 分支：${rs.ref}`, search: `${rs.name} ${rs.filePath} ${names.get(rs.repo) ?? rs.repo} ${rs.ref}`,
    }));
    const score = (name: string) => normalize(name) === query ? 0 : normalize(name).startsWith(query) ? 1 : 2;
    const matches = [...local, ...remote].filter(x => normalize(x.search).includes(query))
      .sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name, 'zh-CN') || a.key.localeCompare(b.key));
    const notices = repositories.filter(r => r.enabled && (!r.builtAt || r.error)).map(r => `${r.name}：${r.error ? '索引更新失败' : '索引尚未就绪'}${r.entries ? '，使用已有索引' : ''}`);
    return c.json({ items: matches.slice(Number(offset), Number(offset) + Number(limit)).map(({ key, label, hint }) => ({ value: key, label, hint })), total: matches.length, notices });
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
