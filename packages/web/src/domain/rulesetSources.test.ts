import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { rulesetSourceQuery, rulesetSourceState, type RuleSourceContent } from './rulesetSources.ts';
import type { RuleSetSourceDoc } from '../hooks.ts';
const source: RuleSetSourceDoc = { id: 's', kind: 'remote', format: 'auto', url: 'https://rules.test/list' };
const success: RuleSourceContent = { content: 'DOMAIN,ok.test', status: { id: 's', ok: true } };
const result = (data?: RuleSourceContent) => ({ data, error: null, isPending: !data, isFetching: false });
afterEach(() => { vi.unstubAllGlobals(); });

describe('来源失败状态与显式重试', () => {
  it('业务错误、HTTP 错误、缺失正文和刷新中均阻止转换；其他预览范围不阻塞，存在的来源都参与检查', () => {
    const failed = result({ status: { id: 's', ok: false, error: '上游失败' } });
    expect(rulesetSourceState([source], [failed])).toMatchObject({ ready: false, reading: false, error: '上游失败' });
    expect(rulesetSourceState([source], [{ ...result(success), error: new Error('HTTP 503') }]).ready).toBe(false);
    expect(rulesetSourceState([source], [result({ status: { id: 's', ok: true } })]).ready).toBe(false);
    expect(rulesetSourceState([source], [{ ...result(success), isFetching: true }]).ready).toBe(false);
    expect(rulesetSourceState([source], [failed]).ready).toBe(false);
    expect(rulesetSourceState([source], [failed], 's').ready).toBe(false);
    expect(rulesetSourceState([source, { ...source, id: 'good' }], [failed, result(success)], 'good').ready).toBe(true);
    expect(rulesetSourceState([source], [result({ status: { id: 's', ok: true, passthrough: true } })]).ready).toBe(true);
  });

  it.each(['业务错误', 'HTTP 错误'])('%s 后重试更新同一查询，并重新允许转换', async failure => {
    const requests: { refresh?: boolean }[] = [];
    const fetcher = vi.fn(async (_: unknown, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      if (requests.length === 1) return failure === '业务错误'
        ? Response.json({ status: { id: 's', ok: false, error: '上游失败' } })
        : Response.json({ error: 'HTTP 503' }, { status: 503 });
      return Response.json(success);
    });
    vi.stubGlobal('fetch', fetcher);
    const cache = new QueryClient();
    const query = rulesetSourceQuery('r', source);
    const observer = new QueryObserver(cache, { ...query, enabled: false });
    const stop = observer.subscribe(() => {});
    try {
      await observer.refetch();
      expect(rulesetSourceState([source], [observer.getCurrentResult()]).ready).toBe(false);
      await cache.fetchQuery(rulesetSourceQuery('r', source, true));
      expect(requests).toHaveLength(2);
      expect(requests[1]!.refresh).toBe(true);
      expect(observer.getCurrentResult().data).toEqual(success);
      expect(rulesetSourceState([source], [observer.getCurrentResult()]).ready).toBe(true);
      await cache.fetchQuery(rulesetSourceQuery('r', { ...source, name: '改名', overrides: [] }));
      expect(requests).toHaveLength(3);
    } finally { stop(); cache.clear(); }
  });
});
