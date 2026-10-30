import { requiredQuery } from '../query.ts';
import { normalizeRulePresence } from '../rule-presence.ts';
import { migrateProfile, profileTemplate } from '../profile-routing.ts';
import type { ProfileDoc } from '../docs.ts';
// 文档增删改查：订阅源、组合、本地节点组、规则集、配置订阅（按用户隔离）。

import { readPagination } from './pagination.ts';
import { Hono } from 'hono';
import { randomId } from '../crypto.ts';
import type { DocKind } from '../docs.ts';
import type { Store } from '../store.ts';
import { HttpError, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { findReferrers, validateDoc } from './validate.ts';

const SEGMENTS: Record<string, DocKind> = {
  sources: 'source',
  collections: 'collection',
  locals: 'local',
  rulesets: 'ruleset',
  profiles: 'profile',
};

const LABEL: Record<DocKind, string> = { source: '订阅源', collection: '组合', local: '本地节点组', ruleset: '规则集', profile: '配置订阅', preset: '基础设置预设' };

export function docRoutes(store: Store) {
  const app = new Hono<ApiEnv>();
  app.use('*', requireUser);

  for (const [seg, kind] of Object.entries(SEGMENTS)) {
    const publicRead = kind === 'ruleset';

    /** 读取当前用户可见的文档；不可见与不存在一样返回 404，不暴露是否存在 */
    const load = (id: string, userId: string) => {
      const row = store.getWithOwner(kind, id);
      if (!row || (!publicRead && row.owner !== userId)) throw notFound(LABEL[kind]);
      return row;
    };

    app.get(`/${seg}`, (c) => {
      if (c.req.query('id') !== undefined) {
        const row = load(requiredQuery(c, 'id'), c.get('user').id);
        return c.json({ item: row.doc, updatedAt: row.updatedAt, writable: kind !== 'ruleset' || row.owner === c.get('user').id || c.get('user').role === 'admin' });
      }
      const options = readPagination(c.req.query());
      const owner = publicRead ? undefined : c.get('user').id;
      const result = options ? store.listPage(kind, options, owner) : { items: store.list(kind, owner) };
      return c.json(kind === 'ruleset' ? { ...result, writableIds: result.items.filter(doc => c.get('user').role === 'admin' || store.getWithOwner(kind, doc.id)?.owner === c.get('user').id).map(doc => doc.id) } : result);
    });

    app.post(`/${seg}`, async (c) => {
      const user = c.get('user');
      const body = await jsonBody(c);
      let doc = validateDoc(kind, body, randomId(9), user, store);
      if (kind === 'profile') doc = { ...migrateProfile(doc as ProfileDoc, profileTemplate(doc as ProfileDoc, (id, v) => store.getTemplate(id, v))), migration: undefined };
      doc = normalizeRulePresence(kind, doc);
      store.put(kind, doc, user.id);
      return c.json({ item: doc }, 201);
    });

    app.put(`/${seg}/:id`, async (c) => {
      const user = c.get('user');
      const id = c.req.param('id');
      const body = await jsonBody(c);
      const current = load(id, user.id);
      if (kind === 'ruleset' && current.owner !== user.id && user.role !== 'admin') throw new HttpError(403, '只有创建者或管理员可以修改公共规则增强');
      if (body.id !== undefined && body.id !== id) throw new HttpError(400, 'id 与路径不一致');
      if (kind === 'profile' && (current.doc as ProfileDoc).routing && body.routing === undefined) throw new HttpError(400, '不能移除分流模式，请使用模式转换');
      let doc = validateDoc(kind, body, id, user, store);
      if (kind === 'profile') doc = { ...migrateProfile(doc as ProfileDoc, profileTemplate(doc as ProfileDoc, (id, v) => store.getTemplate(id, v))), migration: (current.doc as ProfileDoc).migration };
      doc = normalizeRulePresence(kind, doc);
      store.put(kind, doc, kind === 'ruleset' ? current.owner : user.id);
      return c.json({ item: doc });
    });

    app.delete(`/${seg}/:id`, (c) => {
      const user = c.get('user');
      const id = c.req.param('id');
      const row = load(id, user.id);
      if (kind === 'ruleset' && row.owner !== user.id && user.role !== 'admin') throw new HttpError(403, '只有创建者或管理员可以删除公共规则增强');
      const referrers = findReferrers(store, user.id, kind, id);
      if (referrers.length) throw new HttpError(409, `仍被引用，不能删除`, { referrers });
      store.delete(kind, id);
      return c.json({ ok: true });
    });
  }
  return app;
}
