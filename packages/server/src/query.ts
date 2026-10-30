import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from './api/common.ts';

/** 单值参数禁止重复，避免网关、鉴权与业务读取不同的值。 */
export const uniqueQuery: MiddlewareHandler = async (c, next) => {
  if (Object.values(c.req.queries()).some(values => values.length !== 1)) throw new HttpError(400, '查询参数不能重复');
  await next();
};

export function requiredQuery(c: Context, name: string): string {
  const value = c.req.query(name);
  if (!value?.trim()) throw new HttpError(400, `缺少查询参数 ${name}`);
  return value;
}

export function allowedQuery(c: Context, names: readonly string[]): void {
  if (Object.keys(c.req.query()).some(key => !names.includes(key))) throw new HttpError(400, '不支持的查询参数');
}
