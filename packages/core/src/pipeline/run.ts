// 处理链执行（SRC-06 / SRC-11）。确定性：同一输入 + 同一处理链 ⇒ 同一输出（G1）。

import type { OperatorStep, ProxyIR } from '../types.ts';
import { applyOperator, dedupeNames } from './operators.ts';

export type StepTrace = {
  index: number;
  op: OperatorStep['op'];
  enabled: boolean;
  before: number;
  after: number;
  /** 本步改名的节点：按 _key 对齐 */
  renamed: { from: string; to: string }[];
  /** 本步移除的节点名 */
  removed: string[];
  /** 本步执行失败时的原因；失败的步骤不改变节点列表 */
  error?: string;
  /** 逐步预览时提供这一步之后的节点 */
  nodes?: ProxyIR[];
};

export type PipelineResult = { nodes: ProxyIR[]; trace: StepTrace[] };

export type PipelineOptions = {
  /** 每步保存节点快照，供 UI 逐步预览；订阅渲染时不需要 */
  keepSnapshots?: boolean;
};

function diff(before: ProxyIR[], after: ProxyIR[]): Pick<StepTrace, 'renamed' | 'removed'> {
  // 同一 _key 可能出现多次（去重前），按出现顺序配对
  const queue = new Map<string, ProxyIR[]>();
  for (const n of after) {
    const q = queue.get(n._key);
    if (q) q.push(n); else queue.set(n._key, [n]);
  }
  const renamed: StepTrace['renamed'] = [];
  const removed: string[] = [];
  for (const b of before) {
    const a = queue.get(b._key)?.shift();
    if (!a) removed.push(b.name);
    else if (a.name !== b.name) renamed.push({ from: b.name, to: a.name });
  }
  return { renamed, removed };
}

export function runPipeline(input: ProxyIR[], steps: OperatorStep[], opts: PipelineOptions = {}): PipelineResult {
  let nodes = input;
  const trace: StepTrace[] = [];
  steps.forEach((step, index) => {
    const enabled = step.enabled !== false;
    const before = nodes;
    const t: StepTrace = { index, op: step.op, enabled, before: before.length, after: before.length, renamed: [], removed: [] };
    if (enabled) {
      try {
        nodes = applyOperator(step, before);
        Object.assign(t, diff(before, nodes), { after: nodes.length });
      } catch (e) {
        t.error = (e as Error).message;
      }
    }
    if (opts.keepSnapshots) t.nodes = nodes;
    trace.push(t);
  });
  // 末尾自动兜底：名称唯一（SRC-11）
  const unique = dedupeNames(nodes);
  if (unique !== nodes && unique.some((n, i) => n !== nodes[i])) {
    const t: StepTrace = { index: steps.length, op: 'dedupe', enabled: true, before: nodes.length, after: unique.length, ...diff(nodes, unique) };
    if (opts.keepSnapshots) t.nodes = unique;
    trace.push(t);
  }
  return { nodes: unique, trace };
}
