import type { SnapshotMeta } from '../api.ts';

/** 接口按时间倒序返回快照；无成功快照时也保留失败状态。 */
export function sourceFetchSummary(items: SnapshotMeta[], url?: string) {
  if (url !== undefined) items = items.filter(item => item.url === url);
  const lastOk = items.find((item) => item.ok);
  const lastFail = items.find((item) => !item.ok);
  return { lastOk, lastFail, failing: !!lastFail && (!lastOk || lastFail.fetchedAt > lastOk.fetchedAt), okCount: items.filter((item) => item.ok).length };
}
