import type { PageOptions } from '../pagination.ts';
import { HttpError } from './common.ts';

/** 不传分页参数时保留全量接口，供关联选择器和旧客户端使用。 */
export function readPagination(query: Record<string, string>): PageOptions | undefined {
  if (query.page === undefined && query.pageSize === undefined && query.q === undefined) return undefined;
  const positiveInt = (key: string, fallback: number, max: number) => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new HttpError(400, `${key} 必须是 1 到 ${max} 之间的整数`);
    }
    return value;
  };
  return { page: positiveInt('page', 1, Number.MAX_SAFE_INTEGER), pageSize: positiveInt('pageSize', 20, 100), q: (query.q ?? '').trim().toLowerCase() };
}
