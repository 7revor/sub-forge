export function iniValue(value: unknown, quote = false): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('INI 参数必须是文本、数字或布尔值');
  const text = String(value);
  if (/[\r\n\u2028\u2029\0]/.test(text)) throw new Error('INI 参数不能包含换行或空字符');
  return quote || /[,;"']|^\s|\s$|\s#|\s\/\//.test(text) ? JSON.stringify(text) : text;
}

export function iniName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || /[\"';]/.test(name) || name.startsWith('//') || /[,=\r\n\u2028\u2029\0]/.test(name) || /^[#;[\]]/.test(name)) throw new Error('节点或策略名称不能为空或带首尾空格，不能包含逗号、等号、引号、分号、换行或以段落、注释符号开头');
  return name;
}

export function stringifyIniBase(base: Record<string, unknown>): string {
  for (const key of Object.keys(base)) if (!['general', 'host'].includes(key)) throw new Error('基础配置只允许 general 和 host，路由、节点与策略组请在对应页面设置');
  return (['general', 'host'] as const).flatMap(section => {
    const entries = base[section];
    if (entries === undefined) return [];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(section + ' 必须是对象');
    const lines = Object.entries(entries).map(([key, value]) => {
      if (section === 'host' && typeof value !== 'string') throw new Error('host 必须是值为字符串的对象');
      if (!key || key !== key.trim() || /[=\r\n\u2028\u2029\0[\]]/.test(key) || /^[#;]/.test(key)) throw new Error('基础配置字段名不合法');
      const text = Array.isArray(value) ? value.map(v => iniValue(v)).join(', ') : iniValue(value);
      return key + ' = ' + text;
    });
    return lines.length ? ['[' + (section === 'general' ? 'General' : 'Host') + ']', ...lines, ''] : [];
  }).join('\n');
}

/** 行内注释只在引号之外、且分隔符前有空白时生效，保留 URL 中的 //。 */
export function stripIniComment(text: string): string {
  let quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if ((i === 0 || /\s/.test(text[i - 1]!)) && (char === '#' || char === ';' || text.slice(i, i + 2) === '//')) return text.slice(0, i);
  }
  return text;
}
