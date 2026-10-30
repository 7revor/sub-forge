import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cx } from './cx.ts';

/** 搜索属于列表工具栏，使用轻底色和独立语义，与需要填写的表单字段区分。 */
export function SearchInput({ className, disabled, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { placeholder: string }) {
  return <div className={cx('flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line-2 bg-ground px-2.5 transition-colors hover:border-line focus-within:border-brand/50 focus-within:bg-panel focus-within:ring-2 focus-within:ring-brand/15', disabled && 'cursor-not-allowed opacity-50', className)}>
    <Search size={16} aria-hidden="true" className="text-ink-muted" />
    <input {...props} type="search" data-slot="search-input" disabled={disabled} className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed" />
  </div>;
}
