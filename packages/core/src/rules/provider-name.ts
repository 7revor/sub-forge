import type { Matcher, RuleSet, RuleSetSource } from '../types.ts';

const withoutExtension = (file: string) => file.replace(/\.[^.]+(?:\.gz)?$/i, '');

function urlFileName(url: string): string {
  const file = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  try { return withoutExtension(decodeURIComponent(file)); }
  catch (error) {
    // URL 允许不完整的百分号编码；保留可辨认的文件名，显式标记编码问题。
    return `${withoutExtension(file)}（地址编码异常）`;
  }
}

function sourceFileName(sources: RuleSetSource[]): string {
  const source = sources.find(source => source.enabled !== false && (source.repository?.path || source.url));
  if (source?.repository?.path) return withoutExtension(source.repository.path.split('/').at(-1) ?? '');
  return source?.url ? urlFileName(source.url) : '';
}

/** 展示名不承担身份或鉴权；逗号和换行会破坏 RULE-SET 行，必须规范化。 */
export function ruleProviderName(matcher: Extract<Matcher, { kind: 'ruleset' }>, rs: RuleSet): string {
  const name = matcher.remote ? urlFileName(matcher.remote.url)
    : matcher.repository ? sourceFileName(matcher.repository.sources)
    : rs.name.trim() || sourceFileName(rs.sources);
  return name.replace(/,/g, '，').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').trim() || '规则';
}

/** 按资源身份稳定分配名称；预留原始名称，避免 Apple 的后缀占用本来就叫 Apple_2 的资源。 */
export function allocateRuleProviderNames(entries: Map<string, string>): Map<string, string> {
  const reserved = new Set(entries.values());
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const [key, base] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    let name = base;
    for (let i = 2; used.has(name); i++) {
      name = `${base}_${i}`;
      if (reserved.has(name)) { name = base; continue; }
    }
    used.add(name); result.set(key, name);
  }
  return result;
}
