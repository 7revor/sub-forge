import { expect, it } from 'vitest';
import { resourceCacheHint, resourceCacheSummary, type ResourceState } from './resourceStatus.ts';

const rule = (patch: Partial<ResourceState> = {}): ResourceState => ({ kind: 'ruleset', name: '规则', refreshing: false, available: false, ...patch });
const node = (patch: Partial<ResourceState> = {}): ResourceState => ({ kind: 'source', name: '节点', refreshing: false, available: true, lastSuccessAt: 1, ...patch });

it('规则不参与状态判断，缓存有无和刷新中都不影响结果', () => {
  expect(resourceCacheSummary([node(), rule()])).toEqual({ label: '正常', tone: 'ok' });
  expect(resourceCacheSummary([node(), rule({ available: true, lastSuccessAt: 1 })])).toEqual({ label: '正常', tone: 'ok' });
  expect(resourceCacheSummary([node(), rule({ refreshing: true })])).toEqual({ label: '正常', tone: 'ok' });
  expect(resourceCacheSummary([rule({ available: true, lastSuccessAt: 1 })])).toEqual({ label: '本地资源', tone: 'neutral' });
});

it('没有远程节点时是本地资源', () => {
  expect(resourceCacheSummary([])).toEqual({ label: '本地资源', tone: 'neutral' });
});

it('节点失败或没有内容才警告', () => {
  expect(resourceCacheSummary([node()])).toEqual({ label: '正常', tone: 'ok' });
  expect(resourceCacheSummary([node({ refreshing: true })])).toEqual({ label: '刷新中', tone: 'neutral' });
  expect(resourceCacheSummary([node({ available: false, lastSuccessAt: undefined })])).toEqual({ label: '待首次拉取', tone: 'warn' });
  expect(resourceCacheSummary([node({ error: '超时' })])).toEqual({ label: '1 项失败 · 使用旧内容', tone: 'warn' });
  expect(resourceCacheSummary([node({ error: '超时', available: false })])).toEqual({ label: '1 项失败 · 有资源不可用', tone: 'warn' });
});

it('悬停文案不再写逐个资源的下次拉取时间', () => {
  const time = () => '10:00';
  expect(resourceCacheHint(node(), time)).toBe('节点：最后成功 10:00');
  expect(resourceCacheHint(node({ error: '超时' }), time)).toBe('节点：最后成功 10:00；超时');
  expect(resourceCacheHint(node({ available: false, lastSuccessAt: undefined }), time)).toBe('节点：最后成功 无');
});
