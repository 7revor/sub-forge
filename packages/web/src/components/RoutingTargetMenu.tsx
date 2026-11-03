import { Fragment, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { SearchInput } from './SearchInput.tsx';
import { cx } from './ui.tsx';
import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';

type TargetOption = { value: string; label: string; group?: string };

/** 卡片出口：文字区固定 84px（约「🚀 节点选择」宽度），箭头紧随其后并逐行对齐；使用菜单选择，不绘制表单输入框。表单内用 field 显示为与 AsyncSelect 一致的整行下拉。菜单超长时搜索框固定，选项区滚动。extra 在菜单打开后才挂载，用于追加按需加载的选项。 */
export function RoutingTargetMenu({ value, options, onChange, label, placeholder, field = false, id, selectedLabel, extra, searchLabel = '策略组' }: {
  value: string; options: TargetOption[]; onChange: (value: string) => void; label: string; placeholder: string; field?: boolean; id?: string; selectedLabel?: string; extra?: (search: string) => ReactNode; searchLabel?: string;
}) {
  const [search, setSearch] = useState('');
  const display = selectedLabel ?? options.find(option => option.value === value)?.label;
  // 历史内置值仍可回显，菜单只提供直连与拒绝作为新选择。
  const available = options.filter(option => !option.value.startsWith('builtin:') || option.value === 'builtin:DIRECT' || option.value === 'builtin:REJECT');
  const sections = available.filter(option => !option.value.startsWith('group:') || option.label.toLowerCase().includes(search.toLowerCase())).reduce<{ label?: string; options: TargetOption[] }[]>((sections, option) => {
    const last = sections.at(-1);
    if (last && last.label === option.group) last.options.push(option);
    else sections.push({ label: option.group, options: [option] });
    return sections;
  }, []);
  return <DropdownMenu onOpenChange={open => { if (!open) setSearch(''); }}>
    <DropdownMenuTrigger asChild>{field ? <Button type="button" id={id} variant="outline" aria-label={label} title={display ?? placeholder} className={cx('h-9 w-full justify-between text-sm font-normal', !display && 'text-muted-foreground')}>
      <span className="min-w-0 truncate">{display ?? placeholder}</span>
      <ChevronDown className="opacity-50" aria-hidden />
    </Button> : <button type="button" aria-label={label} title={display ?? placeholder}
      className="flex h-8 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pr-1.5 pl-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <span className={cx('w-[84px] min-w-0 flex-none truncate', !display && 'text-muted-foreground')}>{display ?? placeholder}</span>
      <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
    </button>}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[260px] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(360px,calc(100vw-2rem))] flex-col overflow-y-hidden" aria-label={label}>
      <div className="shrink-0 p-1" onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); }}><SearchInput className={cx('h-8', field && 'max-w-none')} aria-label={`搜索出口${searchLabel}`} placeholder={`搜索${searchLabel}`} value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={next => { if (next !== value) onChange(next); }}>
          {sections.map((section, i) => <Fragment key={i}>
            {i > 0 && <DropdownMenuSeparator />}
            {section.label && <DropdownMenuLabel className="text-xs text-muted-foreground">{section.label}</DropdownMenuLabel>}
            {section.options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} textValue={option.label} className="text-sm">
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.value === 'builtin:DIRECT' && <span className="text-muted-foreground">直连</span>}
              {option.value === 'builtin:REJECT' && <span className="text-muted-foreground">拒绝</span>}
            </DropdownMenuRadioItem>)}
          </Fragment>)}
          {extra?.(search)}
        </DropdownMenuRadioGroup>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
