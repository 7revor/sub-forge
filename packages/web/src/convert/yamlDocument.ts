import { isMap, isScalar, isSeq, parseDocument, type Document, type ParseOptions, type DocumentOptions, type SchemaOptions } from 'yaml';

/** 按编辑器所需结构接收列表片段，直接调整语法树，保留注释、原始行号和嵌套列表。 */
export function parseYamlDocument(text: string, options: ParseOptions & DocumentOptions & SchemaOptions = {}, shape: 'mapping' | 'proxies' | 'template' = 'mapping') {
  const doc: Document = parseDocument(text, options);
  const root = doc.contents;
  if (!isSeq(root) || !root.items.length) return doc;
  if (shape === 'proxies') {
    if (root.items.every(isMap)) {
      doc.contents = doc.createNode({ proxies: [] });
      doc.set('proxies', root);
    }
  } else if (shape === 'template' && root.items.every(item => isMap(item) && item.has('name') && item.has('type'))) {
    doc.contents = doc.createNode({ 'proxy-groups': [] });
    doc.set('proxy-groups', root);
  } else if (shape === 'template' && root.items.every(item => isScalar(item) && typeof item.value === 'string')) {
    doc.contents = doc.createNode({ rules: [] });
    doc.set('rules', root);
  } else if (root.items.length === 1 && isMap(root.items[0])) {
    const item = root.items[0];
    item.commentBefore = [root.commentBefore, item.commentBefore].filter(Boolean).join('\n') || undefined;
    doc.contents = item;
  }
  return doc;
}
