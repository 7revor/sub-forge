import { Fragment, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { SearchInput } from './SearchInput.tsx';
import { cx } from './ui.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';

type TargetOption = { value: string; label: string; group?: string };

/** 卡片出口：文字区固定 84px（约「🚀 节点选择」宽度），箭头紧随其后并逐行对齐；使用菜单选择，不绘制表单输入框。 */
export function RoutingTargetMenu({ value, options, onChange, label, placeholder, restoreFocus = true }: {
  value: string; options: TargetOption[]; onChange: (value: string) => void; label: string; placeholder: string; restoreFocus?: boolean;
}) {
  const [search, setSearch] = useState('');
  const focusAfterClose = useRef(restoreFocus);
  const openNodeAfterClose = useRef(false);
  focusAfterClose.current = restoreFocus;
  const selected = options.find(option => option.value === value);
  // 历史内置值仍可回显，菜单只提供直连与拒绝作为新选择。
  const available = options.filter(option => !option.value.startsWith('builtin:') || option.value === 'builtin:DIRECT' || option.value === 'builtin:REJECT');
  const sections = available.filter(option => !option.value.startsWith('group:') || option.label.toLowerCase().includes(search.toLowerCase())).reduce<{ label?: string; options: TargetOption[] }[]>((sections, option) => {
    const last = sections.at(-1);
    if (last && last.label === option.group) last.options.push(option);
    else sections.push({ label: option.group, options: [option] });
    return sections;
  }, []);
  return <DropdownMenu onOpenChange={open => { if (!open) setSearch(''); }}>
    <DropdownMenuTrigger asChild><button type="button" aria-label={label} title={selected?.label ?? placeholder}
      className="flex h-8 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pr-1.5 pl-3 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <span className={cx('w-[84px] min-w-0 flex-none truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? placeholder}</span>
      <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
    </button></DropdownMenuTrigger>
    <DropdownMenuContent onCloseAutoFocus={event => {
      if (openNodeAfterClose.current) {
        openNodeAfterClose.current = false;
        event.preventDefault();
        onChange('node');
      } else if (!focusAfterClose.current) event.preventDefault();
    }} align="end" className="w-[260px] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(360px,calc(100vw-2rem))]" aria-label={label}>
      <div className="p-1" onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); }}><SearchInput className="h-8" aria-label="搜索出口策略组" placeholder="搜索策略组" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <DropdownMenuRadioGroup value={value} onValueChange={next => { if (next === 'node') openNodeAfterClose.current = true; else if (next !== value) onChange(next); }}>
        {sections.map((section, i) => <Fragment key={i}>
          {i > 0 && <DropdownMenuSeparator />}
          {section.label && <DropdownMenuLabel className="px-3 text-xs text-muted-foreground">{section.label}</DropdownMenuLabel>}
          {section.options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} textValue={option.label} className="px-3 text-sm">
            <span className="min-w-0 flex-1 break-words">{option.label}</span>
            {option.value === 'builtin:DIRECT' && <span className="text-muted-foreground">直连</span>}
            {option.value === 'builtin:REJECT' && <span className="text-muted-foreground">拒绝</span>}
            {option.value === value && <Check size={14} className="text-primary" aria-hidden />}
          </DropdownMenuRadioItem>)}
        </Fragment>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
