import { describe, expect, it } from 'vitest';
import { NodeSetResolver, findCollectionCycles, type NodeSetInputs } from '../src/nodeset/resolve.ts';
import { naturalCompare } from '../src/pipeline/operators.ts';
import { runPipeline } from '../src/pipeline/run.ts';
import { parseContent } from '../src/proxy/parse.ts';
import type { OperatorStep, Source } from '../src/types.ts';

const trojan = (name: string, host: string) => `trojan://pw@${host}:443#${encodeURIComponent(name)}`;
const nodes = (...lines: string[]) => parseContent(lines.join('\n'), { type: 'source', id: 'x' }).proxies;

const HK_PIPELINE: OperatorStep[] = [
  { op: 'filter.useless' },
  { op: 'rename.regex', rules: [
    { pattern: '^香港\\s*(\\d+).*$', replace: 'HK-$1' },
    { pattern: '^日本\\s*(\\d+).*$', replace: 'JP-$1' },
  ] },
  { op: 'flag', mode: 'add' },
  { op: 'sort.regex', patterns: ['HK', 'JP'] },
];

describe('PRD 场景 2：改名确定性', () => {
  const src = (body: string): NodeSetInputs => ({
    sources: { x: { id: 'x', name: 'X', urls: ['u'], pipeline: HK_PIPELINE } },
    collections: {},
    locals: {},
    snapshots: { x: [body] },
  });

  it('上游新增 香港 02、删除 香港 01 后，输出只有 🇭🇰 HK-02', () => {
    const before = new NodeSetResolver(src([trojan('香港 01 | 0.5x', 'a'), trojan('剩余流量：10G', 'z')].join('\n'))).resolve({ type: 'source', id: 'x' });
    expect(before.map((n) => n.name)).toEqual(['🇭🇰 HK-01']);

    const after = new NodeSetResolver(src([trojan('香港 02', 'b'), trojan('剩余流量：10G', 'z')].join('\n'))).resolve({ type: 'source', id: 'x' });
    expect(after.map((n) => n.name)).toEqual(['🇭🇰 HK-02']);
  });

  it('同一输入重复执行结果完全相同', () => {
    const body = [trojan('日本 03', 'c'), trojan('香港 01 | 0.5x', 'a'), trojan('美国 08', 'd')].join('\n');
    const a = new NodeSetResolver(src(body)).resolve({ type: 'source', id: 'x' });
    const b = new NodeSetResolver(src(body)).resolve({ type: 'source', id: 'x' });
    expect(a).toEqual(b);
    expect(a.map((n) => n.name)).toEqual(['🇭🇰 HK-01', '🇯🇵 JP-03', '🇺🇸 美国 08']);
  });
});

describe('处理链执行', () => {
  it('逐步预览记录每步的改名与移除', () => {
    const input = nodes(trojan('香港 01 | 0.5x', 'a'), trojan('官网 example.com', 'z'), trojan('日本 03', 'c'));
    const r = runPipeline(input, HK_PIPELINE, { keepSnapshots: true });
    expect(r.trace.map((t) => [t.op, t.before, t.after])).toEqual([
      ['filter.useless', 3, 2],
      ['rename.regex', 2, 2],
      ['flag', 2, 2],
      ['sort.regex', 2, 2],
    ]);
    expect(r.trace[0]!.removed).toEqual(['官网 example.com']);
    expect(r.trace[1]!.renamed).toEqual([{ from: '香港 01 | 0.5x', to: 'HK-01' }, { from: '日本 03', to: 'JP-03' }]);
    expect(r.trace[2]!.nodes!.map((n) => n.name)).toEqual(['🇭🇰 HK-01', '🇯🇵 JP-03']);
  });

  it('禁用的步骤不执行；非法正则的步骤报错并跳过', () => {
    const input = nodes(trojan('A', 'a'), trojan('B', 'b'));
    const r = runPipeline(input, [
      { op: 'filter.regex', patterns: ['A'], keep: true, enabled: false },
      { op: 'filter.regex', patterns: ['(['], keep: true },
      { op: 'rename.affix', prefix: 'x-' },
    ]);
    expect(r.nodes.map((n) => n.name)).toEqual(['x-A', 'x-B']);
    expect(r.trace[1]!.error).toMatch(/非法正则/);
  });

  it('未填写的空正则不生效', () => {
    const input = nodes(trojan('HK 01', 'a'), trojan('US 02', 'b'));
    const r = runPipeline(input, [
      { op: 'rename.regex', rules: [{ pattern: '', replace: 'aa' }, { pattern: '^HK', replace: 'HK-' }] },
      { op: 'filter.regex', patterns: [''], keep: true },
      { op: 'rename.delete', patterns: [''] },
      { op: 'sort.regex', patterns: ['', 'US'] },
    ]);
    expect(r.nodes.map((n) => n.name)).toEqual(['US 02', 'HK- 01']);
  });

  it('末尾自动去重兜底，名称唯一', () => {
    const input = nodes(trojan('HK', 'a'), trojan('HK', 'b'), trojan('HK 2', 'c'));
    const r = runPipeline(input, []);
    expect(r.nodes.map((n) => n.name)).toEqual(['HK', 'HK 3', 'HK 2']);
    expect(r.trace.at(-1)!.op).toBe('dedupe');
  });

  it('按 _key 去重删除重复节点', () => {
    const input = nodes(trojan('A', 'same'), trojan('A 副本', 'same'), trojan('B', 'b'));
    const r = runPipeline(input, [{ op: 'dedupe', by: 'key', strategy: 'drop' }]);
    expect(r.nodes.map((n) => n.name)).toEqual(['A', 'B']);
  });

  it('快捷设置不能改身份字段', () => {
    const r = runPipeline(nodes(trojan('A', 'a')), [{ op: 'set', fields: { udp: true } }, { op: 'set', fields: { server: 'x' } }]);
    expect(r.nodes[0]!.udp).toBe(true);
    expect(r.nodes[0]!.server).toBe('a');
    expect(r.trace[1]!.error).toMatch(/server/);
  });

  it('自然排序与 locale 无关', () => {
    expect(['HK-10', 'HK-2', 'HK-1', 'HK-01'].sort(naturalCompare)).toEqual(['HK-1', 'HK-01', 'HK-2', 'HK-10']);
  });
});

describe('组合', () => {
  const srcOf = (id: string): Source => ({ id, name: id, urls: ['u'], pipeline: [] });

  it('按成员顺序合并，成员前缀生效，再跑组合自身处理链', () => {
    const inputs: NodeSetInputs = {
      sources: { a: srcOf('a'), b: srcOf('b') },
      collections: {
        all: { id: 'all', name: '全部', members: [{ ref: { type: 'source', id: 'a' }, prefix: 'A·' }, { ref: { type: 'source', id: 'b' }, prefix: 'B·' }, { ref: { type: 'local', id: 'self' }, suffix: ' [自建]' }], pipeline: [{ op: 'sort.name', order: 'asc' }] },
      },
      locals: { self: { id: 'self', name: '自建', proxies: [{ name: 'SG', type: 'trojan', server: 's', port: 443, password: 'p' }] } },
      snapshots: { a: [trojan('HK-01', 'a1')], b: [[trojan('HK-01', 'b1'), trojan('JP-01', 'b2')].join('\n')] },
    };
    const res = new NodeSetResolver(inputs);
    expect(res.resolve({ type: 'collection', id: 'all' }).map((n) => n.name)).toEqual(['A·HK-01', 'B·HK-01', 'B·JP-01', 'SG [自建]']);
    expect(res.report.items).toEqual([]);
  });

  it('检测组合引用环', () => {
    const cols = {
      x: { id: 'x', name: 'x', members: [{ ref: { type: 'collection' as const, id: 'y' } }], pipeline: [] },
      y: { id: 'y', name: 'y', members: [{ ref: { type: 'collection' as const, id: 'x' } }], pipeline: [] },
    };
    expect(findCollectionCycles(cols)).toEqual([['x', 'y', 'x']]);
    const res = new NodeSetResolver({ sources: {}, collections: cols, locals: {}, snapshots: {} });
    expect(res.resolve({ type: 'collection', id: 'x' })).toEqual([]);
    expect(res.report.byCode('nodeset.cycle')).toHaveLength(1);
  });

  it('订阅源没有快照时报错', () => {
    const res = new NodeSetResolver({ sources: { r: { id: 'r', name: 'R', urls: ['u'], pipeline: [] } }, collections: {}, locals: {}, snapshots: {} });
    expect(res.resolve({ type: 'source', id: 'r' })).toEqual([]);
    expect(res.report.byCode('source.no-snapshot')).toHaveLength(1);
  });
});
