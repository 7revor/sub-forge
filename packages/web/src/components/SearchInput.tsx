import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cx } from './cx.ts';

/** 搜索属于列表工具栏，统一右对齐，白色背景与输入框一致（页头位于灰色底上）；md 与页头 md 按钮同高，放在列表页页头或卡片头部。 */
export function SearchInput({ className, disabled, size = 'sm', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & { placeholder: string; size?: 'sm' | 'md' }) {
  return <div className={cx('ml-auto flex h-9 w-full max-w-80 min-w-0 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 transition-[border-color,box-shadow]  focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15', size === 'md' && 'h-9 w-60 max-w-full', disabled && 'cursor-not-allowed opacity-50', className)}>
    <Search size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
    <input {...props} type="search" data-slot="search-input" disabled={disabled} className={cx('h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed', size === 'md' && 'text-sm')} />
  </div>;
}
