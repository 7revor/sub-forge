import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';
import type { TreeLoader } from './listbox.tsx';

/** 每次展开独立读取；卸载或换父级后，迟到响应无法写入新目录。 */
export function useOptionPages(loadOptions: TreeLoader, query: string, parent?: string) {
  const session = useId();
  const result = useInfiniteQuery({
    queryKey: ['option-pages', session, query, parent], initialPageParam: 0,
    queryFn: ({ pageParam }) => loadOptions(query, pageParam, parent),
    getNextPageParam: page => page.nextOffset, staleTime: Infinity, gcTime: 0, retry: false,
  });
  return { ...result, options: result.data?.pages.flatMap(page => page.options) ?? [],
    total: result.data?.pages.at(-1)?.total ?? 0,
    notices: [...new Set(result.data?.pages.flatMap(page => page.notices ?? []) ?? [])] };
}

export function OptionPageStatus({ page }: { page: ReturnType<typeof useOptionPages> }) {
  if (page.options.length && !page.hasNextPage && !page.isFetching && !page.isError && !page.notices.length && page.data?.pages[0]?.nextOffset === undefined) return null;
  return <>
    {!!page.notices.length && <div role="status" className="px-3 py-2 text-[12px] text-muted">{page.notices.join('；')}</div>}
    <div role={page.isError ? 'alert' : 'status'} className="shrink-0 border-t border-line-2 px-3 py-2 text-center text-[12px] text-muted">
      {page.isFetching ? '正在读取目录…' : page.isError ? <><span>目录读取失败</span><button type="button" className="ml-2 cursor-pointer text-accent" onClick={() => void (page.data ? page.fetchNextPage({ cancelRefetch: false }) : page.refetch())}>重试</button></> : <>
        <span>{page.total ? `已加载 ${page.options.length} / ${page.total} 项` : '没有可用条目'}</span>
        {page.hasNextPage && <button type="button" className="ml-2 cursor-pointer text-accent" onClick={() => void page.fetchNextPage({ cancelRefetch: false })}>加载更多</button>}
      </>}
    </div>
  </>;
}
