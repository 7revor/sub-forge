import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api.ts';
import type { DocMap, Kind, TemplateDoc } from '../hooks.ts';

export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
type ListMap = DocMap & { templates: TemplateDoc };
export const PAGE_SIZES = [10, 20, 50, 100];

/** 分页与搜索写入地址，刷新及浏览器前进后退时保留列表位置。 */
export function usePagedList<K extends Kind | 'templates'>(kind: K) {
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSize = Number(params.get('pageSize') ?? 20);
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : 20;
  const q = params.get('q') ?? '';
  const query = useQuery({
    queryKey: [kind, 'page', { page, pageSize, q: q.trim() }],
    queryFn: () => api<PageResult<ListMap[K]>>('GET', `/${kind}?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: q.trim() })}`),
    placeholderData: keepPreviousData,
  });
  const update = (patch: Record<string, string>, replace = false) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
      if (kind === 'templates') next.delete('id');
      return next;
    }, { replace });
  };
  // 删除末页最后一条等情况下，服务端会返回实际有效页码。
  useEffect(() => {
    if (query.data && !query.isPlaceholderData && query.data.page !== page) {
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.set('page', String(query.data.page));
        return next;
      }, { replace: true });
    }
  }, [query.data, query.isPlaceholderData, page, setParams]);
  return { ...query, page, pageSize, q,
    setPage: (value: number) => update({ page: String(value) }),
    setPageSize: (value: number) => update({ pageSize: String(value), page: '1' }),
    setQ: (value: string) => update({ q: value, page: '1' }, true),
  };
}
