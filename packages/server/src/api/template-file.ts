import { Hono } from 'hono';
import type { Store } from '../store.ts';
import type { SnapshotService } from '../snapshots.ts';
import { RuleConverter } from '../rule-converter.ts';
import { RuleSourceService } from '../rule-source.ts';
import { ruleSourceFile } from '../rule-files.ts';
import { allowedQuery, requiredQuery } from '../query.ts';
import type { ApiEnv } from './common.ts';

/** 模板专属内容只有登录态预览，永不发行资源 token 地址。 */
export function templateFileRoutes(store: Store, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();
  const getter = new RuleSourceService(snapshots, new RuleConverter());
  app.get('/templates/rule-file', c => {
    allowedQuery(c, ['id', 'rule', 'revision']);
    const id = requiredQuery(c, 'id'), rule = requiredQuery(c, 'rule');
    return ruleSourceFile(c, store, getter, c.get('user').id, () => {
      const matcher = store.getTemplate(id)?.rules.find(r => r.id === rule)?.matcher;
      return matcher?.kind === 'ruleset' ? matcher : undefined;
    }, `template:${id}`, { kind: 'template', id });
  });
  return app;
}
