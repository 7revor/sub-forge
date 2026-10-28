// 按客户端的规则改写与降级（CR-01 / CR-02，docs/04 §3）。

import type { Client, ClientOverride, Platform, RuleIR } from '../types.ts';

export type ClientCtx = { client: Client; platform?: Platform };

export type LoweredRule =
  | { kind: 'ok'; text: string; note?: string }
  | { kind: 'drop'; reason: string };

/** 声明式客户端覆盖：命中第一条匹配的覆盖，返回替换结果（drop 返回空数组） */
export function applyOverrides(rule: RuleIR, overrides: ClientOverride[] | undefined, ctx: ClientCtx): RuleIR[] {
  const hit = overrides?.find((o) => o.when.client === ctx.client && (o.when.platform === undefined || o.when.platform === ctx.platform));
  if (!hit) return [rule];
  return 'drop' in hit.action ? [] : hit.action.replace;
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

const nr = (r: { noResolve?: boolean }) => (r.noResolve ? ',no-resolve' : '');

function lowerMihomo(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP':
      return { kind: 'ok', text: `${rule.type},${rule.value}${nr(rule)}` };
    case 'NETWORK':
      return { kind: 'ok', text: `NETWORK,${rule.value}` };
    case 'PROCESS': {
      const base = rule.kind === 'name' ? 'PROCESS-NAME' : 'PROCESS-PATH';
      const suffix = rule.mode === 'exact' ? '' : rule.mode === 'wildcard' ? '-WILDCARD' : '-REGEX';
      return { kind: 'ok', text: `${base}${suffix},${rule.value}` };
    }
    case 'AND': case 'OR': case 'NOT':
      return { kind: 'drop', reason: '逻辑规则暂不支持（P1）' };
    case 'RAW':
      return rule.client === ctx.client ? { kind: 'ok', text: rule.text } : { kind: 'drop', reason: `原样规则仅对 ${rule.client} 输出` };
    default:
      return { kind: 'ok', text: `${rule.type},${rule.value}` };
  }
}

function lowerSurge(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  switch (rule.type) {
    case 'DOMAIN': case 'DOMAIN-SUFFIX': case 'DOMAIN-KEYWORD': case 'DOMAIN-WILDCARD':
      return { kind: 'ok', text: `${rule.type},${rule.value}` };
    case 'DOMAIN-REGEX':
      return { kind: 'drop', reason: 'Surge 不支持 DOMAIN-REGEX' };
    case 'GEOSITE':
      return { kind: 'drop', reason: 'Surge 不支持 GEOSITE' };
    case 'IP-CIDR': case 'IP-CIDR6': case 'IP-ASN': case 'GEOIP':
      return { kind: 'ok', text: `${rule.type},${rule.value}${nr(rule)}` };
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
      return { kind: 'drop', reason: '逻辑规则暂不支持（P1）' };
    case 'RAW':
      return rule.client === ctx.client ? { kind: 'ok', text: rule.text } : { kind: 'drop', reason: `原样规则仅对 ${rule.client} 输出` };
  }
}

/** 规则匹配部分（不含出口）的客户端写法 */
export function lowerRule(rule: RuleIR, ctx: ClientCtx): LoweredRule {
  return ctx.client === 'mihomo' ? lowerMihomo(rule, ctx) : lowerSurge(rule, ctx);
}
