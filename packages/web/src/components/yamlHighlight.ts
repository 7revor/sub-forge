import { CST, Parser } from 'yaml';

export type YamlTone = 'key' | 'string' | 'number' | 'literal' | 'comment' | 'meta' | 'punctuation';
export type YamlSegment = { text: string; tone?: YamlTone };

/** 直接读取语法 token，不解析别名或重写原文；未完成的 YAML 也可以着色。 */
export function highlightYaml(text: string): YamlSegment[] {
  const ranges: { start: number; end: number; tone: YamlTone }[] = [];
  const pending: { token: CST.Token; key?: boolean }[] = Array.from(new Parser().parse(text), token => ({ token }));
  const add = (token: CST.Token | null | undefined, key = false) => { if (token) pending.push({ token, key }); };
  while (pending.length) {
    const { token, key } = pending.pop()!;
    let tone: YamlTone | undefined;
    if (CST.isScalar(token)) {
      tone = key ? 'key' : 'string';
      if (!key && token.type === 'scalar') {
        const value = CST.resolveAsScalar(token)?.value;
        if (typeof value === 'string' && /^(?:true|false|null|~)$/i.test(value)) tone = 'literal';
        else if (typeof value === 'string' && /^(?:[-+]?(?:0x[\da-f]+|0o[0-7]+|(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|\.inf)|\.nan)$/i.test(value)) tone = 'number';
      }
    } else if (token.type === 'comment') tone = 'comment';
    else if (['anchor', 'alias', 'tag', 'directive', 'directive-line'].includes(token.type)) tone = 'meta';
    else if ('source' in token && !['space', 'newline', 'error', 'byte-order-mark'].includes(token.type)) tone = 'punctuation';
    if (tone && 'source' in token) {
      // 块字符串的 offset 指向 | 或 >，正文实际位于 props 之后。
      const start = token.type === 'block-scalar'
        ? token.offset + token.props.reduce((length, prop) => length + ('source' in prop ? prop.source.length : 0), 0)
        : token.offset;
      ranges.push({ start, end: start + token.source.length, tone });
    }
    if ('start' in token) {
      if (Array.isArray(token.start)) token.start.forEach(item => add(item));
      else add(token.start);
    }
    if ('end' in token) token.end?.forEach(item => add(item));
    if ('props' in token) token.props.forEach(item => add(item));
    if ('value' in token) add(token.value);
    if ('items' in token) for (const item of token.items) {
      item.start.forEach(part => add(part));
      add(item.key, true);
      item.sep?.forEach(part => add(part));
      add(item.value);
    }
  }
  const segments: YamlSegment[] = [];
  let offset = 0;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start < offset || range.end <= range.start) continue;
    if (range.start > offset) segments.push({ text: text.slice(offset, range.start) });
    segments.push({ text: text.slice(range.start, range.end), tone: range.tone });
    offset = range.end;
  }
  if (offset < text.length) segments.push({ text: text.slice(offset) });
  return segments;
}
