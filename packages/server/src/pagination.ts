/** 列表分页元信息；空结果保留第 1 页，删除末页记录后自动回退。 */
export type PageOptions = { page: number; pageSize: number; q: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export function pageMeta(total: number, options: PageOptions) {
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  return { total, page: Math.min(options.page, totalPages), pageSize: options.pageSize, totalPages };
}
