/** 按顶层逗号切分规则，保留引号与逻辑子表达式；反斜杠不丢失。 */
export function splitRuleFields(text: string, nested = true, trim = true): string[] {
  const fields: string[] = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (nested && c === '(') depth++;
    else if (nested && c === ')') { if (--depth < 0) throw new Error('规则括号不匹配'); }
    else if (c === ',' && depth === 0) { fields.push(trim ? text.slice(start, i).trim() : text.slice(start, i)); start = i + 1; }
  }
  if (quote || depth) throw new Error('规则引号或括号未闭合');
  fields.push(trim ? text.slice(start).trim() : text.slice(start));
  return fields;
}
