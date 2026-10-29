import { Document, isAlias, isMap, isNode, isScalar, isSeq, LineCounter, type Node } from 'yaml';
import { parseYamlDocument } from './yamlDocument.ts';
import { getPath, isRecord, setPath, type FieldGroup } from '../components/schema.ts';

/** 返回表单时才执行的恢复解析；不猜测损坏内容，保留能确定含义的字段及身份注释。 */
export function recoverYaml(text: string, shape: 'mapping' | 'template' = 'mapping') {
  try { return recoverDocument(text, shape); }
  catch (error) {
    return { doc: new Document({}), value: {}, notes: [`无法恢复 YAML，已返回空表单：${error instanceof Error ? error.message : String(error)}`] };
  }
}

function recoverDocument(text: string, shape: 'mapping' | 'template') {
  const lines = new LineCounter();
  const sourceLines = text.split('\n');
  const doc: Document = parseYamlDocument(text, { lineCounter: lines, merge: shape === 'template' }, shape);
  const notes: string[] = [];
  const nodes: Node[] = [];
  const collect = (node: unknown, depth = 0) => {
    if (!isNode(node) || depth > 100 || nodes.length > 20_000) return;
    nodes.push(node);
    if (isMap(node)) node.items.forEach((pair) => { collect(pair.key, depth + 1); collect(pair.value, depth + 1); });
    if (isSeq(node)) node.items.forEach((item) => collect(item, depth + 1));
  };
  collect(doc.contents);
  const invalid = new Map<Node, string>();
  for (const error of [...doc.errors, ...doc.warnings]) {
    if (error.code === 'DUPLICATE_KEY') continue; // 下方按映射逐项保留第一个键。
    const pos = error.pos[0];
    const candidates = nodes.filter((node) => node.range && node.range[0] <= pos && pos <= node.range[2]);
    // 未闭合的流式集合常把错误定位到下一行；优先丢弃该集合，避免误删下一行有效字段。
    const flow = candidates.filter((node) => (isMap(node) || isSeq(node)) && node.flow);
    // 标签位于值的 range 之前，不能因此把错误归到整个父映射。
    const tagged = error.code === 'TAG_RESOLVE_FAILED' ? nodes.filter((node) =>
      'tag' in node && node.tag && node.range && node.range[0] >= pos).sort((a, b) => a.range![0] - b.range![0])[0] : undefined;
    const affected = tagged ?? (flow.length ? flow : candidates).sort((a, b) =>
      (a.range![2] - a.range![0]) - (b.range![2] - b.range![0]))[0] ?? doc.contents;
    const message = `第 ${lines.linePos(pos).line} 行：${error.message.split('\n')[0]}`;
    if (isNode(affected)) invalid.set(affected, message);
    else notes.push(message);
  }
  let count = 0;
  const clean = (node: unknown, path: string, parents: Set<Node>): Node | undefined => {
    const ignore = (reason: string) => { notes.push(`已忽略 ${path}：${reason}`); return undefined; };
    if (!isNode(node)) return ignore('无法识别的 YAML 内容');
    if (invalid.has(node)) return ignore(invalid.get(node)!);
    if (++count > 20_000 || parents.size > 100) return ignore('嵌套或引用展开过多');
    if (parents.has(node)) return ignore('循环引用');
    const next = new Set(parents).add(node);
    if (isAlias(node)) {
      const source = node.resolve(doc);
      if (!source) return ignore('引用的锚点不存在');
      const value = clean(source, path, next);
      return value?.clone() as Node | undefined;
    }
    if (isScalar(node)) {
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) return ignore('不是有限数字');
      return node;
    }
    if (isMap(node)) {
      const keys = new Set<string>();
      node.items = node.items.filter((pair) => {
        if (!isScalar(pair.key) || (typeof pair.key.value !== 'string' && !(typeof pair.key.value === 'symbol' && pair.key.value.description === '<<')) || invalid.has(pair.key)) {
          ignore('字段名无效'); return false;
        }
        const key = typeof pair.key.value === 'symbol' ? '<<' : pair.key.value;
        if (keys.has(key)) { notes.push(`已忽略 ${path}.${key} 的重复项，保留第一项`); return false; }
        keys.add(key);
        const value = clean(pair.value, path === '根节点' ? key : `${path}.${key}`, next);
        if (!value) return false;
        pair.value = value;
        return true;
      });
      return node;
    }
    if (isSeq(node)) {
      // YAML 会把第一项的身份/禁用注释放在列表上；过滤首项前先归还，防止转移到下一项。
      const first = node.items[0];
      if (node.commentBefore && isNode(first)) {
        first.commentBefore = [node.commentBefore, first.commentBefore].filter(Boolean).join('\n');
        node.commentBefore = undefined;
      }
      node.items = node.items.flatMap((item, index) => {
        // 未闭合的上一项可能吞入下一项的前置注释；只从同缩进的独立注释行恢复。
        if (isNode(item) && item.range) {
          const start = text.lastIndexOf('\n', item.range[0] - 1) + 1;
          const prefix = text.slice(start, item.range[0]).match(/^(\s*)-\s*$/);
          if (prefix) {
            const comments: string[] = [];
            for (let i = lines.linePos(item.range[0]).line - 2; i >= 0; i--) {
              const before = sourceLines[i]!;
              if (!before.trim()) continue;
              if (!before.startsWith(`${prefix[1]}#`)) break;
              comments.unshift(before.slice(prefix[1]!.length + 1));
            }
            if (comments.length) item.commentBefore = comments.join('\n');
          }
        }
        const value = clean(item, `${path}[${index + 1}]`, next);
        return value ? [value] : [];
      });
      return node;
    }
    return ignore('无法识别的 YAML 类型');
  };
  const root = clean(doc.contents, '根节点', new Set());
  if (!isMap(root)) notes.push('未找到有效的顶层映射，已返回空表单');
  doc.contents = isMap(root) ? root : doc.createNode({});
  doc.errors = [];
  doc.warnings = [];
  return { doc, value: doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown>, notes };
}

/** 仅清理已知表单字段的类型；未知扩展字段完整保留，枚举选项仍允许客户端新增值。 */
export function recoverFields(value: Record<string, unknown>, groups: FieldGroup[], notes: string[]) {
  let result = value;
  const ignore = (key: string, reason: string) => {
    notes.push(`已忽略 ${key}：${reason}`);
    result = setPath(result, key, undefined);
  };
  for (const field of groups.flatMap((group) => group.fields)) {
    const parts = field.key.split('.');
    for (let i = 1; i < parts.length; i++) {
      const key = parts.slice(0, i).join('.');
      const parent = getPath(result, key);
      if (parent !== undefined && !isRecord(parent)) { ignore(key, '需要映射'); break; }
    }
    const item = getPath(result, field.key);
    if (item === undefined) continue;
    const valid = field.type === 'bool' ? typeof item === 'boolean'
      : field.type === 'number' ? typeof item === 'number' && Number.isFinite(item)
        : field.type === 'kv' ? isRecord(item)
          : field.type === 'lines' ? Array.isArray(item) : typeof item === 'string';
    if (!valid) { ignore(field.key, '字段类型不正确'); continue; }
    if (field.type === 'lines' && Array.isArray(item)) {
      result = setPath(result, field.key, item.filter((entry, index) => {
        if (typeof entry === 'string') return true;
        notes.push(`已忽略 ${field.key}[${index + 1}]：需要字符串`);
        return false;
      }));
    }
  }
  return result;
}
