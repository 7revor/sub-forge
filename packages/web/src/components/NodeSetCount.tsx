import type { NodeSetID } from '@sub-forge/core';
import { useNodeList } from '../hooks.ts';
import { cx } from './cx.ts';

export function NodeSetCount({ nodeSet, className }: { nodeSet: NodeSetID; className?: string }) {
  const nodes = useNodeList(nodeSet);
  return <span className={cx('font-mono text-[12.5px]', className)} title={nodes.error?.message}>{nodes.data?.total ?? '—'}</span>;
}
