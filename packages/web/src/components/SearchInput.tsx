import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cx } from './cx.ts';

/** 搜索属于列表工具栏，统一右对齐，白色背景与输入框一致（页头位于灰色底上）；md 与页头 md 按钮同高，放在列表页页头或卡片头部。 */
export function SearchInput({ className, disabled, size = 'sm', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & { placeholder: string; size?: 'sm' | 'md' }) {
  return <div className={cx('ml-auto flex h-9 w-full max-w-80 min-w-0 items-center gap-2 rounded-lg border border-[#d5d9e0] bg-panel px-2.5 transition-colors focus-within:ring-2 focus-within:ring-brand/15', size === 'md' && 'h-10 w-60 max-w-full px-3', disabled && 'cursor-not-allowed opacity-50', className)}>
    <Search size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
    <input {...props} type="search" data-slot="search-input" disabled={disabled} className={cx('h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed', size === 'md' && 'text-[13.5px]')} />
  </div>;
}
