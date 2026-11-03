import { describe, expect, it } from 'vitest';
import { nodeExitFromValue, nodeExitValue } from './RuleTargetSelect.tsx';

describe('规则出口的节点选项', () => {
  it('名称含分隔符时也能还原为精确引用，默认未命中拒绝', () => {
    const ref = { type: 'source' as const, id: 'a:b' };
    expect(nodeExitFromValue(nodeExitValue(ref, '节点:"01"'))).toEqual({ kind: 'node', ref: { nodeSet: ref, match: { exact: '节点:"01"' }, fallback: { kind: 'builtin', name: 'REJECT' } } });
  });
});
