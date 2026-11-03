import { expect, it } from 'vitest';
import { resourceCacheHint, resourceCacheSummary, type ResourceState } from './resourceStatus.ts';

const rule = (available: boolean): ResourceState => ({ kind: 'ruleset', name: '规则', refreshing: false, available, ...(available ? { lastSuccessAt: 1 } : {}) });
const node = (patch: Partial<ResourceState> = {}): ResourceState => ({ kind: 'source', name: '节点', refreshing: false, available: true, lastSuccessAt: 1, ...patch });

it('规则没有快照是正常状态，不用警告色', () => {
  expect(resourceCacheSummary('rulesets', [rule(false)])).toEqual({ label: '使用时拉取', tone: 'neutral' });
  expect(resourceCacheSummary('rulesets', [rule(true), rule(false)])).toEqual({ label: '1 项可用', tone: 'ok' });
  expect(resourceCacheSummary('profiles', [node(), rule(false)])).toEqual({ label: '1 项可用', tone: 'ok' });
});

it('节点失败或没有内容才警告', () => {
  expect(resourceCacheSummary('sources', [node()])).toEqual({ label: '正常', tone: 'ok' });
  expect(resourceCacheSummary('sources', [node({ available: false, lastSuccessAt: undefined })])).toEqual({ label: '待首次拉取', tone: 'warn' });
  expect(resourceCacheSummary('sources', [node({ error: '超时' })])).toEqual({ label: '1 项失败 · 使用旧内容', tone: 'warn' });
  expect(resourceCacheSummary('sources', [node({ error: '超时', available: false })])).toEqual({ label: '1 项失败 · 有资源不可用', tone: 'warn' });
});

it('悬停文案不再写逐个资源的下次拉取时间', () => {
  const time = () => '10:00';
  expect(resourceCacheHint(rule(false), time)).toBe('规则：使用时拉取');
  expect(resourceCacheHint(rule(true), time)).toBe('规则：本周期已拉取 10:00');
  expect(resourceCacheHint(node({ error: '超时' }), time)).toBe('节点：最后成功 10:00；超时');
});
