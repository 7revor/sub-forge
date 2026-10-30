import type { ReportItem } from '@sub-forge/core';
import { isMap, isNode, isSeq, LineCounter, parseDocument } from 'yaml';
import type { CodeRange } from '../../components/CodePreview.tsx';

type NamedRanges = Map<string, CodeRange | undefined>;
type PreviewIndex = { groups: NamedRanges; proxies: NamedRanges; final?: CodeRange };

/** 同名输出无法唯一定位，不能猜测其中一个。 */
function add(ranges: NamedRanges, name: string, range: CodeRange) {
  ranges.set(name, ranges.has(name) ? undefined : range);
}

/** 从本次实际输出建立位置索引，不用模糊文本搜索匹配组名或节点名。 */
export function indexPreview(text: string, format: 'yaml' | 'ini' = 'yaml'): PreviewIndex {
  const index: PreviewIndex = { groups: new Map(), proxies: new Map() };
  if (format === 'ini') {
    let section = '';
    text.split('\n').forEach((line, i) => {
      const heading = /^\[([^\]]+)\]\s*$/.exec(line);
      if (heading) { section = heading[1]!; return; }
      const assignment = /^([^#;][^=]*?)\s*=/.exec(line);
      const range = { startLine: i + 1, endLine: i + 1 };
      if (assignment && (section === 'Proxy Group' || section === 'Proxy')) add(section === 'Proxy Group' ? index.groups : index.proxies, assignment[1]!.trim(), range);
      if (section === 'Rule' && /^(FINAL|MATCH),/.test(line)) index.final = range;
    });
    return index;
  }
  const counter = new LineCounter();
  const document = parseDocument(text, { lineCounter: counter });
  if (document.errors.length || !isMap(document.contents)) return index;
  const position = (range: readonly number[]): CodeRange => {
    let end = range[1]! - 1;
    while (end > range[0]! && /\s/.test(text[end]!)) end--;
    return { startLine: counter.linePos(range[0]!).line, endLine: counter.linePos(end).line };
  };
  for (const [key, ranges] of [['proxy-groups', index.groups], ['proxies', index.proxies]] as const) {
    const sequence = document.get(key, true);
    if (!isSeq(sequence)) continue;
    for (const node of sequence.items) {
      if (!isMap(node) || !node.range) continue;
      const name = node.get('name');
      if (typeof name === 'string') add(ranges, name, position(node.range));
    }
  }
  const rules = document.get('rules', true);
  if (isSeq(rules)) for (const node of rules.items) {
    if (isNode(node) && node.range && /^(MATCH|FINAL),/.test(String(node.toJSON()))) index.final = position(node.range);
  }
  return index;
}

export function locatePreviewIssue(item: ReportItem, index: PreviewIndex, groups: { id: string; name: string }[]): CodeRange | undefined {
  if (item.where === 'final') return index.final;
  if (item.where?.startsWith('proxy:')) return index.proxies.get(item.where.slice(6));
  if (item.where?.startsWith('group:')) {
    const id = item.where.slice(6);
    // 引用完整性校验使用输出名称，其余组诊断使用业务 ID。
    const name = item.code === 'verify.dangling' ? id : groups.find(group => group.id === id)?.name;
    if (name !== undefined) return index.groups.get(name);
  }
  return undefined;
}

export function previewIssueMessage(item: ReportItem): string {
  if (item.code === 'group.empty') return item.message.replace(/^组「(.+)」没有成员，按拒绝输出$/, '「$1」为空，将拒绝连接');
  if (item.code === 'name.conflict') return item.message.replace(/^组名「(.+)」与节点或内置策略重名$/, '「$1」与节点或内置策略重名');
  return item.message;
}
