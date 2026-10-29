// 规则解析：各种规则集格式 → 规则中间表示 RuleIR（RS-02 / RS-03）。
// 无法解析或不支持的行记录下来，不中断。

import { parse as parseYaml } from 'yaml';
import type { Client, RuleIR, RuleSetFormat, RuleSetSource } from '../types.ts';
import { rawRuleParts } from './raw.ts';

export class UnsupportedRuleError extends Error {}

export type ParsedRule = { line: number; text: string; rule: RuleIR };
export type RejectedRule = { line: number; text: string; reason: string };
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
export function parseRuleLine(text: string): RuleIR {
  const parts = text.split(',').map((s) => s.trim());
  const type = (parts[0] ?? '').toUpperCase();
  const value = parts[1] ?? '';
  const opts = new Set(parts.slice(2).map((s) => s.toLowerCase()));
  const ipOptions = { ...(opts.has('no-resolve') ? { noResolve: true } : {}), ...(opts.has('src') ? { src: true } : {}) };
  if (!value && !['AND', 'OR', 'NOT'].includes(type)) throw new Error('缺少规则值');

  switch (type) {
    case 'DOMAIN':
    case 'DOMAIN-SUFFIX':
    case 'DOMAIN-KEYWORD':
    case 'DOMAIN-WILDCARD':
    case 'DOMAIN-REGEX':
      return { type, value };
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return { type: isCidr6(value) ? 'IP-CIDR6' : 'IP-CIDR', value, ...ipOptions };
    case 'IP-ASN':
      return { type, value: value.replace(/^AS/i, ''), ...ipOptions };
    case 'SRC-IP-CIDR':
    case 'SRC-IP':
      return { type: 'SRC-IP-CIDR', value };
    case 'GEOIP':
      return { type, value, ...ipOptions };
    case 'GEOSITE':
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
      throw new UnsupportedRuleError('逻辑规则暂不支持（RS-04，P1）');
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
      rejected.push({ ...e, reason: (err as Error).message });
    }
  }
  return { passthrough: false, format: fmt === 'domain' ? 'domain-set' : fmt, rules, rejected, behavior, ...(fmt === 'yaml' ? { conversion: 'yaml-to-list' as const } : {}) };
}

/** 规则在规则包拆分时归入的 behavior（docs/03 §6） */
export function behaviorOf(rule: RuleIR): Behavior {
  if (rule.type === 'DOMAIN' || rule.type === 'DOMAIN-SUFFIX') return 'domain';
  if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6') return 'ipcidr';
  return 'classical';
}

/** 去重键：type + value（+ 进程规则的 kind/mode） */
export function ruleKey(rule: RuleIR, client?: Client): string {
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
export function parseRuleSourceContent(text: string, source: Pick<RuleSetSource, 'format' | 'repository'>): RuleSetParseResult {
  if (source.format === 'mrs' || source.format === 'srs') return parseRuleSetContent(text, source.format);
  const detected = detectFormat(text);
  const clashDomain = source.format === 'domain' || source.repository?.path.startsWith('rule/Clash/');
  return parseRuleSetContent(text, detected === 'domain-set' && clashDomain ? 'domain' : detected);
}
