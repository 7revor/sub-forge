import { parseDocument, stringify } from 'yaml';
import { CLIENTS, isIniClient, type Client } from '../types.ts';
import { stripIniComment } from '../render/ini-format.ts';

/** 配置族与应用分别命名；规则转换只使用 Client（配置族）。 */
export const CLIENT_APPS = [
  { id: 'flclash', kernel: 'mihomo', label: 'FlClash' },
  { id: 'clash-verge', kernel: 'mihomo', label: 'Clash Verge Rev' },
  { id: 'surge-ios', kernel: 'surge', label: 'Surge iOS', platform: 'ios' },
  { id: 'surge-macos', kernel: 'surge', label: 'Surge macOS', platform: 'macos' },
  { id: 'stash-ios', kernel: 'stash', label: 'Stash iOS', platform: 'ios' },
  { id: 'stash-macos', kernel: 'stash', label: 'Stash macOS', platform: 'macos' },
  { id: 'loon-ios', kernel: 'loon', label: 'Loon iOS', platform: 'ios' },
  { id: 'loon-macos', kernel: 'loon', label: 'Loon macOS', platform: 'macos' },
] as const;
export type ClientApp = typeof CLIENT_APPS[number]['id'];
export type NativeBase = {
  kernels?: Partial<Record<Client, string>>;
  clients?: Partial<Record<ClientApp, string>>;
};
export type ProfileBase = NativeBase & { enabled?: boolean };
type Fields = Record<string, unknown>;
const object = (x: unknown): x is Fields => !!x && typeof x === 'object' && !Array.isArray(x);
const GENERATED_YAML = new Set(['proxies', 'proxy-providers', 'proxy-groups', 'rules', 'rule-providers']);
const GENERATED_INI = new Set(['proxy', 'remote proxy', 'proxy group', 'proxy chain', 'remote filter', 'rule', 'remote rule']);

function checkYamlTree(value: unknown, parents = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (parents.has(value)) throw new Error('YAML 不能包含循环引用');
  const next = new Set([...parents, value]);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('配置包含非法键：' + key);
    checkYamlTree(child, next);
  }
}

/** 只做结构合并，不转换字段含义。数组、标量和 null 由后一层整体替换。 */
export function mergeNativeObjects(base: Fields, patch: Fields, parents = new Set<object>()): Fields {
  if (parents.has(patch)) throw new Error('YAML 不能包含循环引用');
  parents = new Set([...parents, patch]);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('配置包含非法键：' + key);
    out[key] = object(value) ? mergeNativeObjects(object(out[key]) ? out[key] : {}, value, parents) : structuredClone(value);
  }
  return out;
}

export function parseNativeYaml(text: string): Fields {
  if (!text.trim()) return {};
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  if (doc.contents === null) return {};
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!object(value)) throw new Error('YAML 顶层必须是映射');
  checkYamlTree(value);
  return mergeNativeObjects({}, value);
}

type IniSection = { name: string; lines: string[] };
/** 只识别段落及键，不解析 DNS、Hosts、地址列表等原生值。 */
function iniSections(text: string): IniSection[] {
  const sections: IniSection[] = [{ name: '', lines: [] }];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/[\0\u2028\u2029]/.test(line)) throw new Error(`第 ${index + 1} 行包含非法控制字符`);
    const clean = stripIniComment(line).trim();
    const heading = /^\[([^\]]+)\]$/.exec(clean);
    if (heading) { sections.push({ name: heading[1]!.trim(), lines: [] }); continue; }
    const current = sections[sections.length - 1]!;
    if (clean && (!current.name || clean.startsWith('['))) throw new Error(`第 ${index + 1} 行：请填写有效段名，例如 [General]`);
    if (clean && ['general', 'host', 'mitm'].includes(current.name.toLowerCase()) && !/^\S.*?=/.test(clean)) throw new Error(`第 ${index + 1} 行：请使用 字段 = 值`);
    current.lines.push(line);
  }
  return sections;
}

const iniKey = (line: string) => {
  const key = /^\s*([^=]+?)\s*=/.exec(stripIniComment(line))?.[1]?.trim().toLowerCase();
  // 原生条件行由客户端判断；不能用无条件项覆盖带条件的同名参数。
  const condition = /\s+\/\/!REQUIREMENT\s+(.+)$/.exec(line)?.[1];
  return key === undefined ? undefined : key + (condition ? '\0' + condition.trim() : '');
};

export function mergeNativeIni(texts: string[]): string {
  const result: IniSection[] = [];
  for (const text of texts) for (const section of iniSections(text)) {
    const name = section.name.toLowerCase();
    let current = result.find(s => s.name.toLowerCase() === name);
    if (!current) { current = { name: section.name, lines: [] }; result.push(current); }
    const keyed = ['general', 'host', 'mitm'].includes(name);
    while (current.lines.length && !current.lines.at(-1)!.trim()) current.lines.pop();
    const lines = [...section.lines];
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    for (const line of lines) {
      const key = keyed ? iniKey(line) : undefined;
      const index = key === undefined ? -1 : current.lines.findIndex(previous => iniKey(previous) === key);
      if (index < 0) current.lines.push(line); else current.lines[index] = line;
    }
  }
  return result.map(s => [...(s.name ? ['[' + s.name + ']'] : []), ...s.lines].join('\n').trim()).filter(Boolean).join('\n\n') + (texts.some(t => t.trim()) ? '\n' : '');
}

export function validateNativeText(text: unknown, kernel: Client): asserts text is string {
  if (typeof text !== 'string') throw new Error('追加配置必须是原始文本');
  if (isIniClient(kernel)) {
    if (/^\s*#!MANAGED-CONFIG\b/m.test(text)) throw new Error('托管更新地址由订阅生成，请移除 #!MANAGED-CONFIG 行');
    for (const section of iniSections(text)) if (GENERATED_INI.has(section.name.toLowerCase())) throw new Error(`[${section.name}] 由订阅生成，请在节点、策略组或规则设置中编辑`);
  } else {
    for (const key of Object.keys(parseNativeYaml(text))) {
      if (GENERATED_YAML.has(key)) throw new Error(`${key} 由订阅生成，请在节点、策略组或规则设置中编辑`);
    }
  }
}

export function validateNativeBase(value: unknown): asserts value is ProfileBase {
  if (!object(value)) throw new Error('基础配置必须是对象');
  for (const key of Object.keys(value)) if (!['kernels', 'clients', 'enabled'].includes(key)) throw new Error('不支持的基础配置字段：' + key);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  for (const [field, configs] of [['kernels', value.kernels], ['clients', value.clients]] as const) {
    if (configs === undefined) continue;
    if (!object(configs)) throw new Error(field + ' 必须是对象');
    for (const [id, text] of Object.entries(configs)) {
      const kernel = field === 'kernels' ? CLIENTS.find(k => k === id) : CLIENT_APPS.find(c => c.id === id)?.kernel;
      if (!kernel) throw new Error('未知的内核或客户端：' + id);
      if (typeof text !== 'string') throw new Error(id + '：追加配置必须是原始文本');
    }
  }
}

/** 内核公共内容先于可选客户端内容。原文从不回写。 */
export function resolveNativeBase(kernel: Client, app: ClientApp | undefined, profile?: NativeBase): string {
  if (app && CLIENT_APPS.find(c => c.id === app)?.kernel !== kernel) throw new Error('客户端与内核不匹配');
  const texts = [profile?.kernels?.[kernel], app ? profile?.clients?.[app] : undefined].filter((s): s is string => s !== undefined);
  texts.forEach(text => validateNativeText(text, kernel));
  return isIniClient(kernel) ? mergeNativeIni(texts) : texts.length ? stringify(texts.reduce((out, text) => mergeNativeObjects(out, parseNativeYaml(text)), {}), { lineWidth: 0 }) : '';
}

export function iniGeneralValue(text: string, key: string): string | undefined {
  for (const section of iniSections(text)) if (section.name.toLowerCase() === 'general') {
    const line = section.lines.find(line => iniKey(line) === key.toLowerCase());
    if (line) return stripIniComment(line).slice(line.indexOf('=') + 1).trim();
  }
  return undefined;
}
