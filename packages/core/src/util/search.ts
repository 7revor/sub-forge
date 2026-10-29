/** 名称搜索统一为字面包含匹配，忽略大小写与全半角；保留空格和标点。 */
export const normalizeNameSearch = (text: string): string => text.normalize('NFKC').trim().toLowerCase();
export const matchesNameSearch = (name: string, query: string): boolean => normalizeNameSearch(name).includes(normalizeNameSearch(query));
/** SQL LIKE 的包含参数；用户输入的 %、_、反斜线按名称原文处理。 */
export const nameLikePattern = (query: string): string => `%${normalizeNameSearch(query).replace(/[\\%_]/g, '\\$&')}%`;

/** 原始文本中的 UTF-16 半开区间，适合直接交给字符串 slice 渲染。 */
export type SearchMatch = { start: number; end: number };
const searchSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 将规范化后的命中映射回原文，保留全角字符、组合音标和兼容字符的完整字形。 */
export function nameSearchRanges(text: string, query: string): SearchMatch[] {
  const needle = normalizeNameSearch(query);
  if (!needle) return [];
  const parts: string[] = [];
  const origins: SearchMatch[] = [];
  for (const { segment, index } of searchSegments.segment(text)) {
    const normalized = segment.normalize('NFKC');
    parts.push(normalized);
    const origin = { start: index, end: index + segment.length };
    for (let i = 0; i < normalized.toLowerCase().length; i++) origins.push(origin);
  }
  // 整体转小写保留上下文相关大小写语义，例如希腊语词尾 sigma。
  const folded = parts.join('').toLowerCase();
  const ranges: SearchMatch[] = [];
  for (let index = folded.indexOf(needle); index !== -1; index = folded.indexOf(needle, index + 1)) {
    const start = origins[index]!.start;
    const end = origins[index + needle.length - 1]!.end;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}
