import type { NodeSetID } from '@sub-forge/core';

export const NODE_SET_LABEL = { source: '订阅源', collection: '组合', local: '本地节点组' } as const;
export const nodeSetKey = (ref: NodeSetID) => `${ref.type}:${ref.id}`;
export const sameNodeSet = (a: NodeSetID, b: NodeSetID) => a.type === b.type && a.id === b.id;
export function parseNodeSetKey(key: string): NodeSetID {
  const [type, ...rest] = key.split(':');
  if (type !== 'source' && type !== 'collection' && type !== 'local') throw new Error(`未知节点集类型：${type}`);
  return { type, id: rest.join(':') };
}
export const nodeSetPath = (ref: NodeSetID) => `/${ref.type === 'local' ? 'locals' : `${ref.type}s`}/${encodeURIComponent(ref.id)}`;
