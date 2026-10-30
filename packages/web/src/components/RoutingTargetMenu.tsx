import { Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './ui.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';

type TargetOption = { value: string; label: string; group?: string };

/** 卡片出口：固定宽度文字和箭头，使用菜单选择，不绘制表单输入框。 */
export function RoutingTargetMenu({ value, options, onChange, label, placeholder }: {
  value: string; options: TargetOption[]; onChange: (value: string) => void; label: string; placeholder: string;
}) {
  const selected = options.find(option => option.value === value);
  // 历史内置值仍可回显，菜单只提供直连与拒绝作为新选择。
  const available = options.filter(option => !option.value.startsWith('builtin:') || option.value === 'builtin:DIRECT' || option.value === 'builtin:REJECT');
  const sections = available.reduce<{ label?: string; options: TargetOption[] }[]>((sections, option) => {
    const last = sections.at(-1);
    if (last && last.label === option.group) last.options.push(option);
    else sections.push({ label: option.group, options: [option] });
    return sections;
  }, []);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" aria-label={label} title={selected?.label ?? placeholder}
      className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent pr-1.5 pl-3 text-left text-[13px] transition-colors hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <span className={cx('min-w-0 flex-1 truncate', !selected && 'text-ink-muted')}>{selected?.label ?? placeholder}</span>
      <ChevronDown size={14} className="shrink-0 text-faint" aria-hidden />
    </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(360px,calc(100vw-2rem))]" aria-label={label}>
      <DropdownMenuRadioGroup value={value} onValueChange={next => { if (next !== value) onChange(next); }}>
        {sections.map((section, i) => <Fragment key={i}>
          {i > 0 && <DropdownMenuSeparator />}
          {section.label && <DropdownMenuLabel className="text-[12px] text-ink-muted">{section.label}</DropdownMenuLabel>}
          {section.options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} textValue={option.label} className="text-[13px]">
            <span className="min-w-0 break-words">{option.label}</span>
          </DropdownMenuRadioItem>)}
        </Fragment>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
