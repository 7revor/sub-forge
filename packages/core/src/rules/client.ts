// 按客户端的规则改写与降级（CR-01 / CR-02，docs/04 §3）。

import type { Client, ClientOverride, Platform, RuleIR } from '../types.ts';
import { rawRuleError, rawRuleParts } from './raw.ts';

export type ClientCtx = { client: Client; platform?: Platform };

export type LoweredRule =
  | { kind: 'ok'; text: string; noResolve?: boolean; src?: boolean; extendedMatching?: boolean; note?: string }
  | { kind: 'drop'; reason: string };

/**
 * 拼出完整规则行。mihomo 与 Surge 都把 no-resolve 写在出口之后：`IP-CIDR,x,Policy,no-resolve`；
 * 规则集文件内没有出口：`IP-CIDR,x,no-resolve`。
 */
export function composeRule(l: { text: string; noResolve?: boolean; src?: boolean; extendedMatching?: boolean }, target?: string): string {
  return `${l.text}${target === undefined ? '' : `,${target}`}${l.noResolve ? ',no-resolve' : ''}${l.src ? ',src' : ''}${l.extendedMatching ? ',extended-matching' : ''}`;
}

/** 仅叠加 src；no-resolve 始终来自规则原文，忽略历史独立开关。 */
export function withIpOptions(rule: RuleIR, options: { noResolve?: boolean; src?: boolean }): RuleIR {
  if (rule.type === 'RAW' && options.src) {
    if (rawRuleError(rule.text)) return rule;
    const parts = rawRuleParts(rule.text);
    return { ...rule, text: composeRule({ ...parts, src: true }) };
  }
  if (rule.type !== 'IP-CIDR' && rule.type !== 'IP-CIDR6' && rule.type !== 'IP-ASN' && rule.type !== 'GEOIP') return rule;
  return { ...rule, ...(options.src ? { src: true } : {}) };
}

/** 声明式客户端覆盖：命中第一条匹配的覆盖，返回替换结果、保留原规则并追加，或丢弃（空数组） */
export function applyOverrides(rule: RuleIR, overrides: ClientOverride[] | undefined, ctx: ClientCtx): RuleIR[] {
  const hit = overrides?.find((o) => o.when.client === ctx.client && (o.when.platform === undefined || o.when.platform === ctx.platform));
  if (!hit) return [rule];
  return 'drop' in hit.action ? [] : 'append' in hit.action ? [rule, ...hit.action.append] : hit.action.replace;
}

/**
 * 把只含字面量、`.`、`.*` 与首尾锚点的正则转为通配符；做不到时返回 undefined。
 * 用于 Surge 不支持进程正则时的降级（04 §3.2）。
 */
export function regexToWildcard(re: string): string | undefined {
  if (re.startsWith('(?i)')) return undefined; // Surge 进程规则区分大小写，无法等价
  let src = re;
  const anchoredStart = src.startsWith('^');
  const anchoredEnd = src.endsWith('$') && !src.endsWith('\\$');
  if (anchoredStart) src = src.slice(1);
  if (anchoredEnd) src = src.slice(0, -1);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === undefined || /[A-Za-z0-9]/.test(next)) return undefined; // \d \w 等字符类
      out += next;
      i++;
    } else if (ch === '.') {
      if (src[i + 1] === '*') { out += '*'; i++; } else out += '?';
    } else if (/[\[\](){}+*?|^$]/.test(ch)) {
      return undefined;
    } else {
      out += ch;
    }
  }
  if (!anchoredStart && !out.startsWith('*')) out = `*${out}`;
  if (!anchoredEnd && !out.endsWith('*')) out = `${out}*`;
  return out;
}

const nr = (r: { noResolve?: boolean }) => (r.noResolve ? { noResolve: true } : {});

function lowerMihomo(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'USER-AGENT':
    case 'URL-REGEX':
      return { kind: 'drop', reason: `mihomo 不支持 ${rule.type}` };
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP': case 'SRC-IP-CIDR':
      return { kind: 'ok', text: `${rule.type},${rule.value}`, ...nr(rule), ...(rule.src ? { src: true } : {}) };
    case 'NETWORK':
      return { kind: 'ok', text: `NETWORK,${rule.value}` };
    case 'PROCESS': {
      const base = rule.kind === 'name' ? 'PROCESS-NAME' : 'PROCESS-PATH';
      const suffix = rule.mode === 'exact' ? '' : rule.mode === 'wildcard' ? '-WILDCARD' : '-REGEX';
      return { kind: 'ok', text: `${base}${suffix},${rule.value}` };
    }
    case 'AND': case 'OR': case 'NOT':
      return lowerLogical(rule, ctx);
    case 'RAW':
      return lowerRaw(rule, ctx);
    default:
      return { kind: 'ok', text: `${rule.type},${rule.value}` };
  }
}

function lowerSurge(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'DOMAIN': case 'DOMAIN-SUFFIX': case 'DOMAIN-KEYWORD': case 'DOMAIN-WILDCARD': case 'USER-AGENT': case 'URL-REGEX':
      return { kind: 'ok', text: `${rule.type},${rule.value}` };
    case 'DOMAIN-REGEX':
      return { kind: 'drop', reason: 'Surge 不支持 DOMAIN-REGEX' };
    case 'GEOSITE':
      return { kind: 'drop', reason: 'Surge 不支持 GEOSITE' };
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP':
      if (rule.src) {
        if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6') return { kind: 'ok', text: `SRC-IP,${rule.value}`, note: 'src 转换为 Surge 的 SRC-IP' };
        return { kind: 'drop', reason: `Surge 不支持 ${rule.type} 的 src 选项` };
      }
      return { kind: 'ok', text: `${rule.type},${rule.value}`, ...nr(rule) };
    case 'SRC-IP-CIDR':
      return { kind: 'ok', text: `SRC-IP,${rule.value}` };
    case 'DST-PORT':
      return { kind: 'ok', text: `DEST-PORT,${rule.value}` };
    case 'SRC-PORT':
      return { kind: 'ok', text: `SRC-PORT,${rule.value}` };
    case 'NETWORK':
      return { kind: 'ok', text: `PROTOCOL,${rule.value.toUpperCase()}` };
    case 'PROCESS': {
      if (ctx.platform === 'ios') return { kind: 'drop', reason: 'Surge iOS 不支持进程规则' };
      if (rule.mode !== 'regex') return { kind: 'ok', text: `PROCESS-NAME,${rule.value}` };
      const wc = regexToWildcard(rule.value);
      return wc === undefined
        ? { kind: 'drop', reason: `进程正则 ${rule.value} 无法转为 Surge 通配` }
        : { kind: 'ok', text: `PROCESS-NAME,${wc}`, note: `进程正则 ${rule.value} 降级为通配 ${wc}` };
    }
    case 'AND': case 'OR': case 'NOT':
      return lowerLogical(rule, ctx);
    case 'RAW':
      return lowerRaw(rule, ctx);
  }
}

function lowerStash(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'RAW': return lowerRaw(rule, ctx);
    case 'AND': case 'OR': case 'NOT':
      return lowerLogical(rule, ctx);
    case 'URL-REGEX':
      return { kind: 'drop', reason: 'Stash 尚未适配 URL-REGEX' };
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP':
      if (rule.src) return rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6'
        ? { kind: 'ok', text: `SRC-IP,${rule.value}`, note: 'src 转换为 Stash 的 SRC-IP（需 iOS 3.7 / macOS 4.4 或更新版本）' }
        : { kind: 'drop', reason: `Stash 不支持 ${rule.type} 的 src 选项` };
      return { kind: 'ok', text: `${rule.type},${rule.value}`, ...nr(rule) };
    case 'SRC-IP-CIDR':
      return { kind: 'ok', text: `SRC-IP,${rule.value}`, note: 'Stash SRC-IP 需要 iOS 3.7 / macOS 4.4 或更新版本' };
    case 'SRC-PORT':
      return { kind: 'ok', text: `SRC-PORT,${rule.value}`, note: 'Stash SRC-PORT 需要 iOS 3.7 / macOS 4.4 或更新版本' };
    case 'PROCESS': {
      if (ctx.platform !== 'macos') return { kind: 'drop', reason: 'Stash 进程规则仅支持 macOS' };
      if (rule.kind === 'path') return rule.mode === 'exact'
        ? { kind: 'ok', text: `PROCESS-PATH,${rule.value}` }
        : { kind: 'drop', reason: 'Stash 不支持进程路径通配或正则' };
      if (rule.mode !== 'regex') return { kind: 'ok', text: `PROCESS-NAME,${rule.value}` };
      const wildcard = regexToWildcard(rule.value);
      return wildcard === undefined
        ? { kind: 'drop', reason: `进程正则 ${rule.value} 无法转为 Stash 通配` }
        : { kind: 'ok', text: `PROCESS-NAME,${wildcard}`, note: `进程正则 ${rule.value} 降级为通配 ${wildcard}` };
    }
    default: return { kind: 'ok', text: `${rule.type},${rule.value}` };
  }
}

/** Loon 按官方原生规则单独适配；不能把 Surge 专用参数直接透传。 */
function lowerLoon(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'DOMAIN': case 'DOMAIN-SUFFIX': case 'DOMAIN-KEYWORD': case 'USER-AGENT': case 'URL-REGEX':
      return { kind: 'ok', text: `${rule.type},${rule.value}` };
    case 'DOMAIN-WILDCARD':
      return { kind: 'ok', text: `${rule.type},${rule.value}`, note: 'Loon 域名通配规则需要 Build 1008 或更新版本' };
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP':
      return rule.src ? { kind: 'drop', reason: 'Loon 尚未适配源 IP 匹配，不能丢弃 src 后转换为目标 IP' }
        : { kind: 'ok', text: `${rule.type},${rule.value}`, ...nr(rule) };
    case 'SRC-IP-CIDR': case 'DOMAIN-REGEX': case 'GEOSITE':
      return { kind: 'drop', reason: `Loon 尚未适配 ${rule.type}` };
    case 'DST-PORT': case 'SRC-PORT':
      if (rule.value.includes('/')) return { kind: 'drop', reason: 'Loon 不支持斜杠分隔的端口集合，请改用 OR 规则' };
      return { kind: 'ok', text: `${rule.type === 'DST-PORT' ? 'DEST-PORT' : 'SRC-PORT'},${rule.value}` };
    case 'NETWORK': return { kind: 'ok', text: `PROTOCOL,${rule.value.toUpperCase()}` };
    case 'PROCESS': {
      if (ctx.platform !== 'macos') return { kind: 'drop', reason: 'Loon 进程规则仅支持 macOS' };
      const value = rule.mode === 'regex' ? regexToWildcard(rule.value) : rule.value;
      if (value === undefined || (rule.kind === 'path' && value.endsWith('/'))) return { kind: 'drop', reason: '该进程表达式无法等价转换为 Loon 名称或完整路径匹配' };
      const notes = [rule.kind === 'name' ? 'Loon 进程名称匹配不区分大小写' : '', rule.mode === 'regex' ? '进程正则转换为 Loon 通配符' : ''].filter(Boolean);
      return { kind: 'ok', text: `PROCESS-NAME,${value}`, ...(notes.length ? { note: notes.join('；') } : {}) };
    }
    case 'AND': case 'OR': case 'NOT': return lowerLogical(rule, ctx);
    case 'RAW': return lowerRaw(rule, ctx);
  }
}

function lowerRaw(rule: Extract<RuleIR, { type: 'RAW' }>, ctx: ClientCtx): LoweredRule {
  if (rule.client && rule.client !== ctx.client) return { kind: 'drop', reason: `原样规则仅对 ${rule.client} 输出` };
  const error = rawRuleError(rule.text);
  return error ? { kind: 'drop', reason: error } : { kind: 'ok', ...rawRuleParts(rule.text) };
}

/** 规则匹配部分（不含出口）的客户端写法 */
export function lowerRule(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  if (rule.extendedMatching) {
    if (ctx.client !== 'surge') return { kind: 'drop', reason: `${ctx.client} 不支持 extended-matching，不能改变匹配语义` };
    if (!['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'URL-REGEX', 'RAW'].includes(rule.type)) return { kind: 'drop', reason: `${rule.type} 不支持 extended-matching` };
    const lowered = lowerRule({ ...rule, extendedMatching: false }, ctx);
    return lowered.kind === 'ok' ? { ...lowered, extendedMatching: true } : lowered;
  }
  switch (ctx.client) {
    case 'mihomo': return lowerMihomo(rule, ctx);
    case 'surge': return lowerSurge(rule, ctx);
    case 'stash': return lowerStash(rule, ctx);
    case 'loon': return lowerLoon(rule, ctx);
  }
}

/** 任一子条件不可表达时丢弃整条逻辑规则，不能删除子条件后放宽匹配。 */
function lowerLogical(rule: Extract<RuleIR, { type: 'AND' | 'OR' | 'NOT' }>, ctx: ClientCtx): LoweredRule {
  if (!rule.children.length || (rule.type === 'NOT' && rule.children.length !== 1)) return { kind: 'drop', reason: '逻辑规则子条件数量不合法' };
  const children = rule.children.map(child => lowerRule(child, ctx));
  const failure = children.find(child => child.kind === 'drop');
  if (failure?.kind === 'drop') return { kind: 'drop', reason: `${rule.type} 子条件无法转换：${failure.reason}` };
  const accepted = children.filter((child): child is Extract<LoweredRule, { kind: 'ok' }> => child.kind === 'ok');
  const notes = accepted.flatMap(child => child.note ? [child.note] : []);
  return { kind: 'ok', text: `${rule.type},(${accepted.map(child => `(${composeRule(child)})`).join(',')})`, ...(notes.length ? { note: notes.join('；') } : {}) };
}
