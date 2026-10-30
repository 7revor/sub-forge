import { splitRuleFields } from '../rules/syntax.ts';

/** INI 客户端的基础配置，只管理 General / Host；路由段由渲染器生成。 */
export type IniBase = { general?: Record<string, unknown>; host?: Record<string, string> };

export function iniValue(value: unknown, quote = false): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('INI 参数必须是文本、数字或布尔值');
  const text = String(value);
  if (/[\r\n\u2028\u2029\0]/.test(text)) throw new Error('INI 参数不能包含换行或空字符');
  return quote || /[,;"']|^\s|\s$|\s#|\s\/\//.test(text) ? JSON.stringify(text) : text;
}

export function iniName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || /[\"';]/.test(name) || name.startsWith('//') || /[,=\r\n\u2028\u2029\0]/.test(name) || /^[#;[\]]/.test(name)) throw new Error('节点或策略名称不能为空，不能包含逗号、等号、换行或以段落、注释符号开头');
  return name;
}

const LIST_KEYS = new Set(['dns-server', 'encrypted-dns-server', 'doh-server', 'doq-server', 'doh3-server', 'skip-proxy', 'bypass-tun', 'include-tun', 'hijack-dns', 'always-real-ip', 'real-ip', 'tun-included-routes', 'tun-excluded-routes', 'http-listen', 'socks5-listen']);

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

export function parseIniBase(text: string): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  let section = '';
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || /^(#|;|\/\/)/.test(line)) continue;
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      section = heading[1]!.toLowerCase();
      if (!['general', 'host'].includes(section)) throw new Error('第 ' + (index + 1) + ' 行：基础配置只支持 [General] 和 [Host]');
      result[section] ??= {};
      continue;
    }
    const equal = line.indexOf('=');
    if (!section || equal < 1) throw new Error('第 ' + (index + 1) + ' 行：请先填写段名，再使用 字段 = 值');
    const key = line.slice(0, equal).trim(), value = line.slice(equal + 1).trim();
    if (Object.hasOwn(result[section]!, key)) throw new Error('第 ' + (index + 1) + ' 行：字段重复');
    const decode = (s: string): unknown => {
      if (s.startsWith('"')) {
        try { const parsed: unknown = JSON.parse(s); if (typeof parsed === 'string') return parsed; } catch { throw new Error('第 ' + (index + 1) + ' 行：引号格式错误'); }
        throw new Error('第 ' + (index + 1) + ' 行：引号内容必须为文本');
      }
      if (section === 'host') return s;
      if (s === 'true' || s === 'false') return s === 'true';
      if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
      return s;
    };
    result[section]![key] = section === 'general' && LIST_KEYS.has(key) ? splitRuleFields(value, false).filter(Boolean).map(v => { const item = decode(v); return String(item); }) : decode(value);
  }
  stringifyIniBase(result);
  return result;
}
