/** 订阅源只接受一个 HTTP(S) URL；旧客户端的单元素 urls 可无损转换。 */
export function sourceUrl(data: Record<string, unknown>): string {
  let value = data.url;
  if (data.urls !== undefined) {
    if (value !== undefined) throw new Error('订阅源不能同时提供 url 和 urls');
    if (!Array.isArray(data.urls) || data.urls.length !== 1) throw new Error('每个订阅源只允许一个 URL，多个来源请使用组合');
    value = data.urls[0];
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写一个 http(s) 订阅地址');
  const url = value.trim();
  if (/\s/.test(url)) throw new Error('每个订阅源只允许一个 URL，地址中不能包含空白');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('订阅地址必须是有效的 http(s) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('订阅地址必须是有效的 http(s) URL');
  return url;
}

/** 兼容旧请求和种子：移除订阅源已停用的独立拉取选项。 */
export function normalizeSourceFetch<T extends { fetch?: { ttlSec?: number } }>(source: T): T {
  const { fetch, ...rest } = source;
  return rest as T;
}
