/** 接口路径只含固定分类，动态值统一由 URLSearchParams 编码。 */
export function queryUrl(path: string, values: Record<string, string | number | boolean | undefined>, base = ''): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value));
  return `${base.replace(/\/$/, '')}${path}${query.size ? `?${query}` : ''}`;
}
