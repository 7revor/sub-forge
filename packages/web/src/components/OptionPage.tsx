import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';
import type { SearchMatch } from '@sub-forge/core';
import { HighlightedText } from './HighlightedText.tsx';
import { cx } from './cx.ts';

export type PageOption = { value: string; label: string; hint?: string; disabled?: boolean; matches?: { label: SearchMatch[]; hint: SearchMatch[] } };
export type OptionPage = { options: PageOption[]; total: number; nextOffset?: number; notices?: string[] };
export type OptionLoader = (query: string, offset: number) => Promise<OptionPage>;

/** 每个列表实例与关键词隔离缓存；迟到响应不会覆盖新搜索。 */
export function useOptionPages(loadOptions: OptionLoader, query: string) {
  const session = useId();
  const result = useInfiniteQuery({
    queryKey: ['option-pages', session, query], initialPageParam: 0,
    queryFn: ({ pageParam }) => loadOptions(query, pageParam),
    getNextPageParam: page => page.nextOffset, staleTime: Infinity, gcTime: 0, retry: false,
  });
  return { ...result, options: result.data?.pages.flatMap(page => page.options) ?? [],
    total: result.data?.pages.at(-1)?.total ?? 0,
    notices: [...new Set(result.data?.pages.flatMap(page => page.notices ?? []) ?? [])] };
}

export function OptionPageStatus({ page }: { page: ReturnType<typeof useOptionPages> }) {
  return <>
    {!!page.notices.length && <div role="status" className="px-3 py-2 text-[12px] text-muted">{page.notices.join('；')}</div>}
    <div role={page.isError ? 'alert' : 'status'} className="shrink-0 border-t border-line-2 px-3 py-2 text-center text-[12px] text-muted">
      {page.isFetching ? '正在加载…' : page.isError ? <><span title={page.error?.message}>加载失败</span><button type="button" className="ml-2 cursor-pointer text-accent" onClick={() => void (page.data ? page.fetchNextPage({ cancelRefetch: false }) : page.refetch())}>重试</button></> : <>
        <span>{page.total ? `已加载 ${page.options.length} / ${page.total} 项` : '没有匹配的文件或规则集'}</span>
        {page.hasNextPage && <button type="button" className="ml-2 cursor-pointer text-accent" onClick={() => void page.fetchNextPage({ cancelRefetch: false })}>加载更多</button>}
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
    <div id={id} role="listbox" aria-label={label} aria-busy={page.isFetching} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'));
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
        options[next]?.focus();
      }}>
      {page.options.map(option => <button key={option.value} type="button" role="option" aria-selected={selected === option.value}
        disabled={!allowUnavailable && option.disabled} onClick={() => onSelect(option.value)}
        className={cx('flex min-h-14 w-full cursor-pointer flex-col justify-center gap-0.5 rounded-md px-3 py-2 text-left text-[13px] hover:bg-ground focus:bg-ground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50', selected === option.value && 'bg-ground')}>
        <span className="w-full truncate" title={option.label}><HighlightedText text={option.label} matches={option.matches?.label} /></span>
        <span className="w-full truncate text-[11.5px] text-muted" title={option.hint}><HighlightedText text={option.hint ?? ''} matches={option.matches?.hint} /></span>
      </button>)}
    </div>
    <OptionPageStatus page={page} />
  </>;
}
