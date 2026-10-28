/** 转义为可放进正则的字面量 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** 精确匹配某个名称的正则（包装组 filter 用） */
export function exactNameRegex(name: string): string {
  return `^${escapeRegex(name)}$`;
}

/**
 * 编译用户提供的正则。支持 `(?i)` 前缀（mihomo / Surge 常见写法）。
 * 非法正则抛出带上下文的错误，由调用方写入报告。
 */
export function compileUserRegex(pattern: string, extraFlags = ''): RegExp {
  let flags = extraFlags;
  let src = pattern;
  if (src.startsWith('(?i)')) {
    src = src.slice(4);
    if (!flags.includes('i')) flags += 'i';
  }
  try {
    return new RegExp(src, flags.includes('u') ? flags : flags + 'u');
  } catch (e) {
    throw new Error(`非法正则 ${JSON.stringify(pattern)}：${(e as Error).message}`);
  }
}
