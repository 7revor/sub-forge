// 节点集解析（docs/03 §3 ①）：Source / Collection / 本地节点组 → 处理后的 ProxyIR[]。
// 只读快照，不做网络请求；快照由上层（拉取与缓存层）提供。

import { finalizeProxy, parseContent } from '../proxy/parse.ts';
import { runPipeline } from '../pipeline/run.ts';
import { Report } from '../report.ts';
import type { Collection, ID, LocalProxyGroup, NodeSetID, ProxyIR, Source } from '../types.ts';

export type NodeSetInputs = {
  sources: Record<ID, Source>;
  collections: Record<ID, Collection>;
  locals: Record<ID, LocalProxyGroup>;
  /** 订阅源的原始快照：按 Source.urls 顺序给出正文；缺失表示从未拉取成功 */
  snapshots: Record<ID, string[]>;
};

export const nodeSetKey = (ref: NodeSetID) => `${ref.type}:${ref.id}`;

/** 组合引用图必须是 DAG（COL-04）。返回所有环（以 ID 序列表示），空数组表示无环 */
export function findCollectionCycles(collections: Record<ID, Collection>): ID[][] {
  const cycles: ID[][] = [];
  const state = new Map<ID, 'visiting' | 'done'>();
  const stack: ID[] = [];
  const visit = (id: ID) => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') { cycles.push([...stack.slice(stack.indexOf(id)), id]); return; }
    state.set(id, 'visiting');
    stack.push(id);
    for (const m of collections[id]?.members ?? []) if (m.ref.type === 'collection') visit(m.ref.id);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of Object.keys(collections).sort()) visit(id);
  return cycles;
}

export class NodeSetResolver {
  private readonly cache = new Map<string, ProxyIR[]>();
  private readonly resolving: string[] = [];

  constructor(private readonly inputs: NodeSetInputs, readonly report: Report = new Report()) {}

  resolve(ref: NodeSetID): ProxyIR[] {
    const key = nodeSetKey(ref);
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (this.resolving.includes(key)) {
      this.report.error('nodeset.cycle', `组合引用成环：${[...this.resolving, key].join(' → ')}`, key);
      return [];
    }
    this.resolving.push(key);
    let nodes: ProxyIR[];
    try {
      nodes = ref.type === 'source' ? this.resolveSource(ref.id) : ref.type === 'collection' ? this.resolveCollection(ref.id) : this.resolveLocal(ref.id);
    } finally {
      this.resolving.pop();
    }
    this.cache.set(key, nodes);
    return nodes;
  }

  private pipeline(where: string, nodes: ProxyIR[], steps: Source['pipeline']): ProxyIR[] {
    const r = runPipeline(nodes, steps);
    for (const t of r.trace) {
      if (t.error) this.report.error('pipeline.step-failed', `处理链第 ${t.index + 1} 步（${t.op}）失败，已跳过：${t.error}`, where);
    }
    return r.nodes;
  }

  private resolveSource(id: ID): ProxyIR[] {
    const src = this.inputs.sources[id];
    const where = `source:${id}`;
    if (!src) { this.report.error('nodeset.missing', `订阅源不存在`, where); return []; }
    const bodies = this.inputs.snapshots[id];
    if (!bodies) { this.report.error('source.no-snapshot', `订阅源「${src.name}」没有可用快照`, where); return []; }
    const ref: NodeSetID = { type: 'source', id };
    const parsed: ProxyIR[] = [];
    for (const body of bodies) {
      const r = parseContent(body, ref);
      parsed.push(...r.proxies);
      for (const f of r.failures) this.report.warn('source.parse-failure', `「${src.name}」有节点解析失败：${f.reason}`, where);
    }
    return this.pipeline(where, parsed, src.pipeline);
  }

  private resolveCollection(id: ID): ProxyIR[] {
    const col = this.inputs.collections[id];
    const where = `collection:${id}`;
    if (!col) { this.report.error('nodeset.missing', `组合不存在`, where); return []; }
    const merged: ProxyIR[] = [];
    for (const m of col.members) {
      const nodes = this.resolve(m.ref);
      // 成员前后缀等价于自动插入一个改名处理器（COL-03）
      merged.push(...(m.prefix || m.suffix ? nodes.map((n) => ({ ...n, name: `${m.prefix ?? ''}${n.name}${m.suffix ?? ''}` })) : nodes));
    }
    return this.pipeline(where, merged, col.pipeline);
  }

  private resolveLocal(id: ID): ProxyIR[] {
    const grp = this.inputs.locals[id];
    const where = `local:${id}`;
    if (!grp) { this.report.error('nodeset.missing', `本地节点组不存在`, where); return []; }
    const ref: NodeSetID = { type: 'local', id };
    const nodes = grp.proxies.map((p) => finalizeProxy(p, ref));
    return this.pipeline(where, nodes, []);
  }
}
