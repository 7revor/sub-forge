// P0 内置处理器（SRC-07）。每个处理器都是纯函数 (nodes) => nodes，不修改入参。

import type { Operator, ProxyIR } from '../types.ts';
import { compileUserRegex } from '../util/regex.ts';
import { addFlag, removeFlags } from './flags.ts';

export const DEFAULT_USELESS_PATTERNS = [
  '剩余流量', '已用流量', '总流量', '流量重置', '距离下次重置', '套餐', '到期', '过期', '有效期',
  '官网', '网址', '客服', '(?i)expire', '(?i)traffic', '(?i)\\bremaining\\b',
];

/** 名称自然排序：数字段按数值比较，其余按码点，结果不依赖运行环境的 locale */
export function naturalCompare(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? [];
  const tb = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i]!;
    const y = tb[i]!;
    if (x === y) continue;
    const dx = /^\d/.test(x);
    const dy = /^\d/.test(y);
    if (dx && dy) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      if (x.length !== y.length) return x.length - y.length;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return ta.length - tb.length;
}

const anyMatch = (regs: RegExp[], s: string) => regs.some((r) => r.test(s));
const rename = (p: ProxyIR, name: string): ProxyIR => (name === p.name ? p : { ...p, name });
const tidy = (s: string) => s.replace(/\s{2,}/g, ' ').trim();

/** 同名节点追加序号，保证唯一（SRC-11）。首次出现的保留原名 */
export function dedupeNames(nodes: ProxyIR[]): ProxyIR[] {
  const used = new Set(nodes.map((n) => n.name));
  const seen = new Set<string>();
  return nodes.map((n) => {
    if (!seen.has(n.name)) { seen.add(n.name); return n; }
    let i = 2;
    while (used.has(`${n.name} ${i}`)) i++;
    const name = `${n.name} ${i}`;
    used.add(name);
    seen.add(name);
    return { ...n, name };
  });
}

/** 未填写的规则（空正则）不生效：空正则会匹配每个字符间隙，改名时会把替换内容插满整个名称 */
const filled = (pattern: string) => pattern !== '';

/** 对 `set` 处理器开放的字段：不允许改身份字段与隐式字段 */
const PROTECTED_FIELDS = new Set(['name', 'type', 'server', 'port']);

export function applyOperator(op: Operator, nodes: ProxyIR[]): ProxyIR[] {
  switch (op.op) {
    case 'filter.regex': {
      const regs = op.patterns.filter(filled).map((p) => compileUserRegex(p));
      if (!regs.length) return nodes;
      return nodes.filter((n) => anyMatch(regs, n.name) === op.keep);
    }
    case 'filter.type': {
      const types = new Set(op.types.map((t) => t.toLowerCase()));
      return nodes.filter((n) => types.has(n.type.toLowerCase()) === op.keep);
    }
    case 'filter.useless': {
      const regs = (op.patterns ?? DEFAULT_USELESS_PATTERNS).filter(filled).map((p) => compileUserRegex(p));
      return nodes.filter((n) => !anyMatch(regs, n.name));
    }
    case 'rename.regex': {
      const rules = op.rules.filter((r) => filled(r.pattern)).map((r) => ({ re: compileUserRegex(r.pattern, (r.flags ?? '').replace('g', '') + 'g'), replace: r.replace }));
      return nodes.map((n) => rename(n, tidy(rules.reduce((name, r) => name.replace(r.re, r.replace), n.name))));
    }
    case 'rename.delete': {
      const regs = op.patterns.filter(filled).map((p) => compileUserRegex(p, 'g'));
      return nodes.map((n) => rename(n, tidy(regs.reduce((name, r) => name.replace(r, ''), n.name))));
    }
    case 'rename.affix':
      return nodes.map((n) => rename(n, `${op.prefix ?? ''}${n.name}${op.suffix ?? ''}`));
    case 'flag':
      return nodes.map((n) => rename(n, op.mode === 'add' ? addFlag(n.name) : removeFlags(n.name)));
    case 'sort.name': {
      const sign = op.order === 'desc' ? -1 : 1;
      return [...nodes].sort((a, b) => sign * naturalCompare(a.name, b.name));
    }
    case 'sort.regex': {
      const regs = op.patterns.filter(filled).map((p) => compileUserRegex(p));
      const rank = (n: ProxyIR) => { const i = regs.findIndex((r) => r.test(n.name)); return i < 0 ? regs.length : i; };
      return [...nodes].sort((a, b) => rank(a) - rank(b));
    }
    case 'dedupe': {
      if (op.by === 'key') {
        const seen = new Set<string>();
        const kept = nodes.filter((n) => (seen.has(n._key) ? false : (seen.add(n._key), true)));
        return op.strategy === 'suffix' ? dedupeNames(kept) : kept;
      }
      if (op.strategy === 'drop') {
        const seen = new Set<string>();
        return nodes.filter((n) => (seen.has(n.name) ? false : (seen.add(n.name), true)));
      }
      return dedupeNames(nodes);
    }
    case 'set': {
      const bad = Object.keys(op.fields).filter((k) => PROTECTED_FIELDS.has(k) || k.startsWith('_'));
      if (bad.length) throw new Error(`快捷设置不能修改字段：${bad.join(', ')}`);
      return nodes.map((n) => ({ ...n, ...op.fields }));
    }
    case 'script':
      throw new Error('脚本处理器需要沙箱执行环境，内核不直接运行（SRC-08）');
  }
}
