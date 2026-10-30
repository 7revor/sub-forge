// 规则解析：各种规则集格式 → 规则中间表示 RuleIR（RS-02 / RS-03）。
// 无法解析或不支持的行记录下来，不中断。

import { usesClashDomains } from './remote.ts';
import { parse as parseYaml } from 'yaml';
import type { Client, RuleIR, RuleSetFormat, RuleSetSource } from '../types.ts';
import { rawRuleParts } from './raw.ts';
import { splitRuleFields } from './syntax.ts';

// 二进制读取层在解码文本前写入此标记，防止把转换后正文误判为可直连的原始 URL。
export const DECODED_MRS_HEADER = '# sub-forge: decoded-mrs-v1';

export class UnsupportedRuleError extends Error {}

export type ParsedRule = { line: number; text: string; rule: RuleIR };
export type RejectedRule = { line: number; text: string; reason: string; kind: 'invalid' | 'unimplemented' };
export type Behavior = 'domain' | 'ipcidr' | 'classical';

export type RuleSetParseResult =
  | { passthrough: false; format: Exclude<RuleSetFormat, 'auto' | 'mrs' | 'srs'>; rules: ParsedRule[]; rejected: RejectedRule[]; behavior: Behavior; conversion?: 'yaml-to-list' }
  | { passthrough: true; format: 'mrs' | 'srs' };

const PROCESS_TYPES: Record<string, { kind: 'name' | 'path'; mode: 'exact' | 'wildcard' | 'regex' }> = {
  'PROCESS-PATH': { kind: 'path', mode: 'exact' },
  'PROCESS-NAME-WILDCARD': { kind: 'name', mode: 'wildcard' },
  'PROCESS-PATH-WILDCARD': { kind: 'path', mode: 'wildcard' },
  'PROCESS-NAME-REGEX': { kind: 'name', mode: 'regex' },
  'PROCESS-PATH-REGEX': { kind: 'path', mode: 'regex' },
};

const isCidr6 = (v: string) => v.includes(':');

/**
 * 解析单条 classical 规则（不含出口）：`TYPE,value[,options]`。
 * 兼容 mihomo 与 Surge 的写法差异，统一到 IR。
 */
export function parseRuleLine(text: string, depth = 0): RuleIR {
  if (depth > 10) throw new Error('逻辑规则嵌套不能超过 10 层');
  const logical = /^(AND|OR|NOT)\s*,/i.test(text.trim());
  const parts = splitRuleFields(text, logical);
  const type = (parts[0] ?? '').toUpperCase();
  const value = parts[1] ?? '';
  const opts = new Set(parts.slice(2).map((s) => s.toLowerCase()));
  const allowed = ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'].includes(type) ? ['no-resolve', 'src']
    : ['SRC-IP-CIDR', 'SRC-IP'].includes(type) ? ['no-resolve']
    : ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'URL-REGEX'].includes(type) ? ['extended-matching'] : [];
  for (const option of opts) if (!allowed.includes(option)) throw new Error(`规则 ${type} 暂不支持选项 ${option}，不能丢弃后转换`);
  const extended = opts.has('extended-matching') ? { extendedMatching: true } : {};
  const ipOptions = { ...(opts.has('no-resolve') ? { noResolve: true } : {}), ...(opts.has('src') ? { src: true } : {}) };
  if (!value && !['AND', 'OR', 'NOT'].includes(type)) throw new Error('缺少规则值');

  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
    case 'DOMAIN-KEYWORD':
    case 'DOMAIN-WILDCARD':
    case 'DOMAIN-REGEX':
    case 'URL-REGEX':
      return { type, value, ...extended };
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return { type: isCidr6(value) ? 'IP-CIDR6' : 'IP-CIDR', value, ...ipOptions };
    case 'IP-ASN':
      return { type, value: value.replace(/^AS/i, ''), ...ipOptions };
    case 'SRC-IP-CIDR':
    case 'SRC-IP':
      return { type: 'SRC-IP-CIDR', value, ...ipOptions };
    case 'GEOIP':
      return { type, value, ...ipOptions };
    case 'GEOSITE':
    case 'USER-AGENT':
      return { type, value };
    case 'DST-PORT':
    case 'DEST-PORT':
      return { type: 'DST-PORT', value };
    case 'SRC-PORT':
      return { type, value };
    case 'NETWORK':
    case 'PROTOCOL': {
      const v = value.toLowerCase();
      if (v !== 'tcp' && v !== 'udp') throw new UnsupportedRuleError(`不支持的协议类型 ${value}`);
      return { type: 'NETWORK', value: v };
    }
    case 'PROCESS-NAME': {
      // Surge 的 PROCESS-NAME 同时承担路径与通配（04 §3.2）
      const kind = value.startsWith('/') ? 'path' : 'name';
      const mode = /[*?]/.test(value) ? 'wildcard' : 'exact';
      return { type: 'PROCESS', kind, mode, value };
    }
    case 'AND':
    case 'OR':
    case 'NOT':
      if (!value.startsWith('(') || !value.endsWith(')')) throw new Error('逻辑规则需要括号包裹子规则');
      const children = splitRuleFields(value.slice(1, -1)).map(child => {
        if (!child.startsWith('(') || !child.endsWith(')')) throw new Error('每条逻辑子规则需要单独的括号');
        return parseRuleLine(child.slice(1, -1), depth + 1);
      });
      if (!children.length || (type === 'NOT' && children.length !== 1)) throw new Error('NOT 必须且只能包含一条子规则');
      return { type, children };
    default: {
      const proc = PROCESS_TYPES[type];
      if (proc) return { type: 'PROCESS', ...proc, value };
      throw new UnsupportedRuleError(`不支持的规则类型 ${type}`);
    }
  }
}

/** 纯域名行（Surge DOMAIN-SET / mihomo domain behavior） */
export function parseDomainLine(text: string, dialect: 'surge' | 'clash' = 'surge'): RuleIR {
  // 域名列表不能把 HTML、JSON 或错误说明当成域名；保留通配符、国际化域名与内网单标签。
  if (!/^(?:\+\.)?\.?[\p{L}\p{N}_*?-]+(?:\.[\p{L}\p{N}_*?-]+)*\.?$/u.test(text)) throw new Error('不是有效的域名规则');
  if (text.startsWith('+.')) return { type: 'DOMAIN-SUFFIX', value: text.slice(2) };
  // Surge 的前导点包含根域；Clash 的前导点只包含子域。
  if (text.startsWith('.')) return dialect === 'clash'
    ? { type: 'DOMAIN-WILDCARD', value: `*${text}` }
    : { type: 'DOMAIN-SUFFIX', value: text.slice(1) };
  if (/[*?]/.test(text)) return { type: 'DOMAIN-WILDCARD', value: text };
  return { type: 'DOMAIN', value: text };
}

export function parseCidrLine(text: string): RuleIR {
  if (!/^[0-9a-f:.]+\/\d+$/i.test(text)) throw new Error('不是 CIDR');
  return { type: isCidr6(text) ? 'IP-CIDR6' : 'IP-CIDR', value: text };
}

type TextFormat = Exclude<RuleSetFormat, 'auto' | 'mrs' | 'srs'>;

/** URL 扩展名只用于禁止把已知 YAML 地址标成二进制透传；自动解析仍依据实际内容。 */
export function isYamlRuleUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return /\.ya?ml$/i.test(new URL(url).pathname); } catch { return false; }
}

const hasYamlPayload = (text: string) => /^\s*(?:payload|"payload"|'payload')\s*:/m.test(text) || /^\s*\{\s*["']?payload["']?\s*:/.test(text);

function detectFormat(text: string): TextFormat {
  if (hasYamlPayload(text)) return 'yaml';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith(';'));
  if (lines.length && lines.every((l) => /^[0-9a-f:.]+\/\d+$/i.test(l))) return 'ipcidr';
  if (lines.length && lines.every((l) => !l.includes(','))) return 'domain-set';
  return 'classical';
}

function behaviorOfYaml(items: string[]): Behavior {
  if (items.every((i) => /^[0-9a-f:.]+\/\d+$/i.test(i))) return 'ipcidr';
  if (items.every((i) => !i.includes(','))) return 'domain';
  return 'classical';
}

export function parseRuleSetContent(text: string, format: RuleSetFormat = 'auto', yamlBehavior?: Behavior): RuleSetParseResult {
  if (format === 'mrs' || format === 'srs') {
    if (hasYamlPayload(text)) throw new Error('YAML 规则需要自动转换为 LIST 并托管，不能透传');
    return { passthrough: true, format };
  }
  const fmt: TextFormat = format === 'auto' ? detectFormat(text) : format;
  const rules: ParsedRule[] = [];
  const rejected: RejectedRule[] = [];

  let entries: { line: number; text: string }[];
  let lineParser: (t: string) => RuleIR;
  let behavior: Behavior;
  if (fmt === 'yaml') {
    const doc = parseYaml(text) as { payload?: unknown[] } | null;
    if (!doc || !Array.isArray(doc.payload)) throw new Error('规则 YAML 需要 payload 数组');
    if (!doc.payload.every((item) => typeof item === 'string')) throw new Error('规则 YAML 的 payload 条目必须是字符串');
    const payload = doc.payload as string[];
    behavior = yamlBehavior ?? behaviorOfYaml(payload);
    entries = payload.map((t, i) => ({ line: i + 1, text: t.trim() }));
    lineParser = behavior === 'domain' ? t => parseDomainLine(t, 'clash') : behavior === 'ipcidr' ? parseCidrLine : parseRuleLine;
  } else {
    entries = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t.trim() }))
      .filter((e) => e.text && !e.text.startsWith('#') && !e.text.startsWith('//') && !e.text.startsWith(';'));
    behavior = fmt === 'domain-set' || fmt === 'domain' ? 'domain' : fmt === 'ipcidr' ? 'ipcidr' : 'classical';
    lineParser = behavior === 'domain' ? t => parseDomainLine(t, fmt === 'domain' ? 'clash' : 'surge') : fmt === 'ipcidr' ? parseCidrLine : parseRuleLine;
  }

  for (const e of entries) {
    try {
      rules.push({ ...e, rule: lineParser(e.text) });
    } catch (err) {
      rejected.push({ ...e, reason: (err as Error).message, kind: err instanceof UnsupportedRuleError ? 'unimplemented' : 'invalid' });
    }
  }
  return { passthrough: false, format: fmt === 'domain' ? 'domain-set' : fmt, rules, rejected, behavior, ...(fmt === 'yaml' ? { conversion: 'yaml-to-list' as const } : {}) };
}

/** 规则在规则包拆分时归入的 behavior（docs/03 §6） */
export function behaviorOf(rule: RuleIR): Behavior {
  if (rule.extendedMatching) return 'classical';
  if (rule.type === 'DOMAIN' || rule.type === 'DOMAIN-SUFFIX') return 'domain';
  if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6') return 'ipcidr';
  return 'classical';
}

/** 去重键：type + value（+ 进程规则的 kind/mode） */
export function ruleKey(rule: RuleIR, client?: Client): string {
  if (rule.extendedMatching) return `${ruleKey({ ...rule, extendedMatching: false }, client)}|extended-matching`;
  switch (rule.type) {
    case 'PROCESS': return `PROCESS|${rule.kind}|${rule.mode}|${client === 'mihomo' && rule.mode === 'wildcard' ? rule.value.toLowerCase() : rule.value}`;
    case 'DOMAIN-WILDCARD': return `${rule.type}|${client === 'mihomo' ? rule.value.toLowerCase() : rule.value}`;
    case 'AND': case 'OR': case 'NOT': return `${rule.type}|${rule.children.map(child => ruleKey(child, client)).join(';')}`;
    case 'RAW': {
      if (client === 'mihomo' && (!rule.client || rule.client === client)) {
        const match = /^(PROCESS-(NAME|PATH)-WILDCARD|DOMAIN-WILDCARD)\s*,\s*(.+)$/i.exec(rawRuleParts(rule.text).text);
        if (match) return match[2]
          ? `PROCESS|${match[2].toLowerCase()}|wildcard|${match[3]!.toLowerCase()}`
          : `DOMAIN-WILDCARD|${match[3]!.toLowerCase()}`;
      }
      return `RAW|${rule.client ?? '*'}|${rule.text}`;
    }
    default: return `${rule.type}|${rule.value}`;
  }
}

/** 业务入口始终按内容识别；历史格式只用于区分域名方言和兼容二进制来源。 */
export function parseRuleSourceContent(text: string, source: Pick<RuleSetSource, 'format' | 'repository' | 'url'>): RuleSetParseResult {
  if (source.format === 'mrs' || source.format === 'srs') return parseRuleSetContent(text, source.format);
  const detected = detectFormat(text);
  const clashDomain = usesClashDomains(source);
  return parseRuleSetContent(text, detected === 'domain-set' && clashDomain ? 'domain' : detected);
}
