/** 名称搜索统一为字面包含匹配，忽略大小写与全半角；保留空格和标点。 */
export const normalizeNameSearch = (text: string): string => text.normalize('NFKC').trim().toLowerCase();
export const matchesNameSearch = (name: string, query: string): boolean => normalizeNameSearch(name).includes(normalizeNameSearch(query));
/** SQL LIKE 的包含参数；用户输入的 %、_、反斜线按名称原文处理。 */
export const nameLikePattern = (query: string): string => `%${normalizeNameSearch(query).replace(/[\\%_]/g, '\\$&')}%`;
