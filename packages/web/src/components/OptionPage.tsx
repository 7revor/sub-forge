import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';
import type { SearchMatch } from '@sub-forge/core';
import { HighlightedText } from './HighlightedText.tsx';
import { CommandList, CommandItem } from './ui/command.tsx';

export type PageOption = { value: string; label: string; hint?: string; disabled?: boolean; matches?: { label: SearchMatch[]; hint: SearchMatch[] } };
export type OptionPage = { options: PageOption[]; total: number; nextOffset?: number; notices?: string[] };
export type OptionLoader = (query: string, offset: number) => Promise<OptionPage>;

/** 每个列表实例与关键词隔离缓存；迟到响应不会覆盖新搜索。 */
export function useOptionPages(loadOptions: OptionLoader, query: string) {
  const session = useId();
  const result = useInfiniteQuery({
    queryKey: ['option-pages', session, query], initialPageParam: 0,
    queryFn: ({ pageParam }) => loadOptions(query, pageParam),
    getNextPageParam: page => page.nextOffset, staleTime: 0, gcTime: 0, retry: false,
  });
  return { ...result, options: result.data?.pages.flatMap(page => page.options) ?? [],
    total: result.data?.pages.at(-1)?.total ?? 0,
    notices: [...new Set(result.data?.pages.flatMap(page => page.notices ?? []) ?? [])] };
}

export function OptionPageStatus({ page }: { page: ReturnType<typeof useOptionPages> }) {
  return <>
    {!!page.notices.length && <div role="status" className="px-3 py-2 text-[12px] text-ink-muted">{page.notices.join('；')}</div>}
    <div role={page.isError ? 'alert' : 'status'} className="shrink-0 border-t border-line-2 px-3 py-2 text-center text-[12px] text-ink-muted">
      {page.isFetching ? '正在加载…' : page.isError ? <><span title={page.error?.message}>加载失败</span><button type="button" className="ml-2 cursor-pointer text-brand" onClick={() => void (page.data ? page.fetchNextPage({ cancelRefetch: false }) : page.refetch())}>重试</button></> : <>
        <span>{page.total ? `已加载 ${page.options.length} / ${page.total} 项` : '没有匹配的文件或规则集'}</span>
        {page.hasNextPage && <button type="button" className="ml-2 cursor-pointer text-brand" onClick={() => void page.fetchNextPage({ cancelRefetch: false })}>加载更多</button>}
      </>}
    </div>
  </>;
}

/** 两行平铺候选，键盘和鼠标共用同一选择入口；后续页仅由“加载更多”触发。 */
export function PagedOptionList({ loadOptions, query, onSelect, selected, allowUnavailable = false, id, label = '规则文件' }: {
  loadOptions: OptionLoader; query: string; onSelect: (value: string) => void;
  selected?: string; allowUnavailable?: boolean; id?: string; label?: string;
}) {
  const page = useOptionPages(loadOptions, query);
  return <>
    <CommandList id={id} aria-label={label} aria-busy={page.isFetching}>
      {page.options.map(option => <CommandItem key={option.value} value={option.value} data-checked={selected === option.value}
        disabled={!allowUnavailable && option.disabled} onSelect={() => onSelect(option.value)} className="flex flex-col items-start">
        <span className="w-full truncate" title={option.label}><HighlightedText text={option.label} matches={option.matches?.label} /></span>
        <span className="w-full truncate text-[11.5px] text-ink-muted" title={option.hint}><HighlightedText text={option.hint ?? ''} matches={option.matches?.hint} /></span>
      </CommandItem>)}
    </CommandList>
    <OptionPageStatus page={page} />
  </>;
}
