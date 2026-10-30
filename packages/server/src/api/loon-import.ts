import { Hono } from 'hono';
import { importLoonConfig, renderLoon, renderMihomo, renderSurge, renderStash, resolveNativeBase, type LoonImport, type ReportItem, type Client } from '@sub-forge/core';
import type { Store } from '../store.ts';
import { randomId } from '../crypto.ts';
import { bad, jsonBody, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

/** 仅用本地节点校验，远程来源等待正常快照流程；导入预览不会请求用户订阅。 */
function compatibility(plan: LoonImport) {
  return Object.fromEntries((['mihomo', 'surge', 'loon', 'stash'] as Client[]).map(client => {
    const result = ({ mihomo: renderMihomo, surge: renderSurge, loon: renderLoon, stash: renderStash }[client])({
      profile: plan.profile,
      base: resolveNativeBase(client, undefined, plan.profile.base),
      nodeSets: { locals: Object.fromEntries(plan.locals.map(x => [x.id,x])), sources: Object.fromEntries(plan.sources.map(x => [x.id,x])), collections: Object.fromEntries(plan.collections.map(x => [x.id,x])), snapshots: Object.fromEntries(plan.sources.map(x => [x.id, ['']])) },
      rules: { rulesets: {}, snapshots: {} }, urls: { provider: () => 'https://example.invalid/provider', ruleset: () => 'https://example.invalid/rules' },
    });
    return [client, [...result.report.items.map(item => item.code === 'ruleset.missing' ? { ...item, level: 'info' as const, code: 'loon.import-remote-unchecked', message: '远程规则内容尚未拉取，暂未校验内容兼容性' } : item)]];
  })) as Record<Client, ReportItem[]>;
}
export function loonImportRoutes(store: Store) {
  const app = new Hono<ApiEnv>(); app.use('/profiles/import/loon', requireUser);
  app.post('/profiles/import/loon', async c => {
    const body = await jsonBody(c), user = c.get('user');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2_000_000) throw bad('请填写不超过 2 MB 的 Loon 配置');
    if (typeof body.name !== 'string' || !body.name.trim()) throw bad('请填写导入后的订阅名称');
    if (body.final !== undefined && typeof body.final !== 'string') throw bad('最终出口必须为文本');
    if (body.save !== undefined && typeof body.save !== 'boolean') throw bad('save 必须为布尔值');
    const plan = importLoonConfig(body.text, { id: randomId(9), name: body.name.trim(), ...(body.final ? { final: String(body.final) } : {}) });
    let clients: Record<Client, ReportItem[]> | undefined;
    if (!plan.report.some(r => r.level === 'error')) {
      clients = compatibility(plan);
      // 本地链环、节点语法等 Loon 自身错误必须先解决；其他端的不兼容仅展示在对应报告中。
      plan.report.push(...clients.loon.filter(r => r.level === 'error' && !r.code.startsWith('ruleset.')));
    }
    if (!body.save) return c.json({ plan, clients, remoteChecked: false });
    if (plan.report.some(r => r.level === 'error')) return c.json({ error: '请先修复导入诊断中的错误', report: plan.report }, 400);
    const profile = store.db.transaction(() => {
      // 新随机 ID，全部引用只来自规划；后续验证失败整体回滚，沿用现有用户令牌。
      for (const source of plan.sources) store.put('source', validateDoc('source', source, source.id, user, store), user.id);
      for (const local of plan.locals) store.put('local', validateDoc('local', local, local.id, user, store), user.id);
      for (const collection of plan.collections) store.put('collection', validateDoc('collection', collection, collection.id, user, store), user.id);
      const profile = validateDoc('profile', plan.profile, plan.profile.id, user, store);
      store.put('profile', profile, user.id); return profile;
    })();
    return c.json({ item: profile, report: plan.report, clients, remoteChecked: false }, 201);
  });
  return app;
}
