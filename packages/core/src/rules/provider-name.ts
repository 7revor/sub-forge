import type { Matcher, RuleSet } from '../types.ts';

/** 展示名不承担身份或鉴权；逗号和换行会破坏 RULE-SET 行，必须规范化。 */
export function ruleProviderName(matcher: Extract<Matcher, { kind: 'ruleset' }>, rs: RuleSet): string {
  let name = rs.name;
  if (matcher.remote) {
    const path = new URL(matcher.remote.url).pathname;
    const file = path.split('/').filter(Boolean).at(-1) ?? '';
    try { name = decodeURIComponent(file); }
    catch (error) {
      // URL 允许不完整的百分号编码；保留可辨认的文件名，显式标记编码问题。
      name = `${file}（地址编码异常）`;
    }
    name = name.replace(/\.(?:list|txt|ya?ml|mrs|srs)(?:\.gz)?$/i, '');
  }
  return name.replace(/,/g, '，').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').trim() || '远程规则';
}

/** 按资源身份稳定分配名称；预留原始名称，避免 Apple 的后缀占用本来就叫 Apple (2) 的资源。 */
export function allocateRuleProviderNames(entries: Map<string, string>): Map<string, string> {
  const reserved = new Set(entries.values());
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const [key, base] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    let name = base;
    for (let i = 2; used.has(name); i++) {
      name = `${base} (${i})`;
      if (reserved.has(name)) { name = base; continue; }
    }
    used.add(name); result.set(key, name);
  }
  return result;
}
