// 节点订阅分享：接收者只读可引用，所有返回给接收者的内容都经过这里脱敏，不暴露原始地址、处理链和备注。

import type { SourceDoc } from './docs.ts';
import type { Store } from './store.ts';

/** 上游错误可能带主机名，接收者只看到这句。 */
export const SHARED_SOURCE_ERROR = '上游拉取失败，详情仅分享者可见';

export const sharedSourceView = (store: Store, doc: SourceDoc, owner: string | null): SourceDoc & { sharedBy: string } => ({
  id: doc.id, name: doc.name, url: '', pipeline: [],
  sharedBy: (owner ? store.getUser(owner)?.username : undefined) ?? '其他用户',
});

export const sharedSnapshotView = <T extends { url: string; error?: string }>(row: T): T => ({
  ...row, url: '', ...(row.error ? { error: SHARED_SOURCE_ERROR } : {}),
});

/** 资源状态的节点项用 source:<id> 标识；规则项是公共资源，不需要处理。 */
export function sharedStatusView<T extends { kind: string; resource: string; error?: string }>(store: Store, item: T, userId: string): T {
  if (item.kind !== 'source' || !item.error) return item;
  return store.getWithOwner('source', item.resource.slice('source:'.length))?.owner === userId ? item : { ...item, error: SHARED_SOURCE_ERROR };
}
