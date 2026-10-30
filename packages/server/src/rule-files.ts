import { stableHash, stableStringify } from '@sub-forge/core';
import type { Context } from 'hono';
import { HttpError } from './api/common.ts';
import type { Store } from './store.ts';
import type { RuleSourceService } from './rule-source.ts';
import { resolveRuleSetReference, type RuleSetMatcher } from './ruleset-reference.ts';

/** 只读取已保存引用；根对象删除、引用替换和来源改变均不能返回在途旧正文。 */
export async function ruleSourceFile(c: Context, store: Store, getter: RuleSourceService, userId: string,
  read: () => RuleSetMatcher | undefined, context?: string, root?: { kind: string; id: string }) {
  const matcher = read();
  if (!matcher) return c.body(null, 404);
  if (root && c.req.query('revision') !== stableHash(stableStringify(matcher))) return c.text('规则已修改，请先保存并重新打开文件链接', 409);
  const rs = resolveRuleSetReference(matcher, store);
  if (!rs) return c.body(null, 404);
  const original = stableStringify({ matcher, rs });
  let deleted = false;
  let invalidated = false;
  const invalidate = (kind: string, id: string) => {
    if (kind === 'ruleset' && id === rs.id || root && kind === root.kind && id === root.id) deleted = true;
  };
  store.invalidationListeners.add(invalidate);
  const current = () => {
    const next = read();
    if (deleted || !next || !resolveRuleSetReference(next, store)) { invalidated = true; throw new HttpError(404, '规则不存在'); }
    if (stableStringify({ matcher: next, rs: resolveRuleSetReference(next, store) }) !== original) { invalidated = true; throw new HttpError(409, '规则在读取期间发生变化，请重新打开链接'); }
  };
  try {
    const sources = rs.sources.filter(source => source.enabled !== false);
    if (sources.some(source => source.format === 'mrs' || source.format === 'srs')) return c.text('二进制规则无法作为文本展示，请使用规则订阅链接', 415);
    const bodies: string[] = [];
    for (const source of sources) {
      const result = await getter.get(userId, source, rs, false, context);
      current();
      if (result.content === undefined) return c.text(result.status.error ?? '规则来源暂时不可用', 503);
      if (result.status.error) c.header('x-sub-forge-warning', 'last-good-source');
      bodies.push(result.content);
    }
    current();
    c.set('accessResource', { kind: matcher.repository || matcher.remote ? 'rule-collection' : 'enhancement', resourceId: rs.id, resourceName: rs.name });
    c.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(rs.name)}.txt`);
    return c.text(bodies.join('\n'));
  } finally {
    store.invalidationListeners.delete(invalidate);
    // 限流队列可能在删除后才开始读取，结束时清除其晚建的失效绑定。
    if (deleted || invalidated) store.pruneResourceBindings();
  }
}
