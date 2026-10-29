import { expect, it } from 'vitest';
import type { SnapshotMeta } from '../api.ts';
import { sourceFetchSummary } from './sourceFetch.ts';

const snap = (ok: boolean, fetchedAt: number): SnapshotMeta => ({ id: fetchedAt, ok, fetchedAt, url: 'https://example.test/sub' });
it('区分未拉取、没有快照的失败及失败后使用快照', () => {
  expect(sourceFetchSummary([])).toMatchObject({ lastOk: undefined, failing: false, okCount: 0 });
  expect(sourceFetchSummary([snap(false, 2)])).toMatchObject({ lastOk: undefined, failing: true });
  expect(sourceFetchSummary([snap(false, 3), snap(true, 2), snap(true, 1)])).toMatchObject({ failing: true, lastOk: { fetchedAt: 2 }, okCount: 2 });
});
it('后续拉取成功会清除失败状态', () => {
  expect(sourceFetchSummary([snap(true, 3), snap(false, 2), snap(true, 1)])).toMatchObject({ failing: false, lastOk: { fetchedAt: 3 }, okCount: 2 });
});

it('更换地址后不把旧地址的成功内容和流量显示成当前地址状态', () => {
  const old = snap(true, 1);
  const failed = { ...snap(false, 2), url: 'https://example.test/new' };
  expect(sourceFetchSummary([old], failed.url)).toMatchObject({ lastOk: undefined, failing: false });
  expect(sourceFetchSummary([failed, old], failed.url)).toMatchObject({ lastOk: undefined, failing: true });
});
