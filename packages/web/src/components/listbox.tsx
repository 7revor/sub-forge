// 业务选项与数据加载集中在这里；视觉、键盘交互和动效使用官方组件。
import { matchesNameSearch, normalizeNameSearch } from '@sub-forge/core';
import { Check, ChevronDown } from 'lucide-react';
import { Children, Fragment, isValidElement, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { PagedOptionList, type OptionLoader } from './OptionPage.tsx';
import { cx } from './cx.ts';
import { Button } from './ui/button.tsx';
import { Select as ShadcnSelect, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from './ui/select.tsx';
import { Popover, PopoverTrigger, PopoverAnchor, PopoverContent } from './ui/popover.tsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuCheckboxItem } from './ui/dropdown-menu.tsx';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './ui/command.tsx';

type Opt = { value: string; label: ReactNode; text: string; hint?: ReactNode; disabled?: boolean; group?: string };

const textOf = (n: ReactNode): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(n)) return textOf(n.props.children);
  return '';
};

/** 把 <option> / <optgroup> / Fragment 子节点展开成选项表，沿用原生 select 的写法 */
function collect(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean; 'data-hint'?: ReactNode }>;
    if (el.type === Fragment) collect(el.props.children, group, out);
    else if (el.type === 'optgroup') collect(el.props.children, el.props.label, out);
    else if (el.type === 'option') {
      const text = textOf(el.props.children);
      out.push({ value: String(el.props.value ?? text), label: el.props.children, text, hint: el.props['data-hint'], disabled: el.props.disabled, group });
    }
  });
  return out;
}

export type SelectProps = Omit<HTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> & {
  value?: string | number; onChange?: (e: { target: { value: string } }) => void; disabled?: boolean; children?: ReactNode; placeholder?: string;
};

/** 仅将既有业务 option 数据转换为官方 SelectItem，保留空值选项。 */
export function Select({ value, onChange, disabled, children, placeholder = '请选择', className, ...rest }: SelectProps) {
  const opts = collect(children);
  const current = value == null ? '' : String(value);
  const selected = opts.find(option => option.value === current);
  const groups = opts.reduce<{ label?: string; options: Opt[] }[]>((groups, option) => {
    const last = groups.at(-1);
    if (last && last.label === option.group) last.options.push(option);
    else groups.push({ label: option.group, options: [option] });
    return groups;
  }, []);
  return <ShadcnSelect value={selected ? `value:${current}` : ''} disabled={disabled}
    onValueChange={next => { const value = next.slice(6); if (value !== current) onChange?.({ target: { value } }); }}>
    <SelectTrigger {...rest} className={cx('w-full', className)}><SelectValue placeholder={placeholder}>{selected?.label}</SelectValue></SelectTrigger>
    <SelectContent aria-label={rest['aria-label']}>
      {groups.map((group, i) => <SelectGroup key={i}>
        {group.label && <SelectLabel>{group.label}</SelectLabel>}
        {group.options.map((option, j) => <SelectItem key={`${option.value}-${j}`} value={`value:${option.value}`} disabled={option.disabled} textValue={option.text}>
          <span>{option.label}{option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}</span>
        </SelectItem>)}
      </SelectGroup>)}
    </SelectContent>
  </ShadcnSelect>;
}

export type ComboOption = { value: string; label?: ReactNode; hint?: ReactNode };

/** 使用官方复选菜单；空字符串选项表示清空。 */
export function MultiSelect({ value, onChange, children, placeholder = '请选择', className, disabled, ...rest }: Omit<SelectProps, 'value' | 'onChange'> & {
  value: string[]; onChange: (value: string[]) => void;
}) {
  const opts = collect(children);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button {...rest} type="button" variant="outline" disabled={disabled} className={cx('w-full justify-between', className)}>
      <span className="truncate">{value.length ? opts.filter(option => value.includes(option.value)).map(option => option.text).join('、') : placeholder}</span><ChevronDown />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent>
      {opts.map((option, i) => <Fragment key={`${option.value}-${i}`}>
        {option.group && option.group !== opts[i - 1]?.group && <DropdownMenuLabel>{option.group}</DropdownMenuLabel>}
        <DropdownMenuCheckboxItem checked={option.value ? value.includes(option.value) : value.length === 0} disabled={option.disabled}
          onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onChange(!option.value ? [] : checked ? [...value, option.value] : value.filter(item => item !== option.value))}>
          {option.label}
        </DropdownMenuCheckboxItem>
      </Fragment>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** 官方 Command + Popover 组合，保留业务允许自由输入的行为。 */
export function Combobox({ value, onChange, options, className, placeholder, disabled, empty, ...rest }: Omit<HTMLAttributes<HTMLInputElement>, 'onChange'> & {
  value: string; onChange: (v: string) => void; options: ComboOption[]; placeholder?: string; disabled?: boolean; empty?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const q = filtering ? normalizeNameSearch(value) : '';
  const opts = options.filter(option => matchesNameSearch(option.value, q));
  return <Command shouldFilter={false} className={className}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild><div>
        <CommandInput {...rest} placeholder={placeholder} disabled={disabled} value={value} aria-expanded={open}
          onFocus={event => { rest.onFocus?.(event); setFiltering(false); setOpen(true); }}
          onClick={() => setOpen(true)}
          onValueChange={next => { onChange(next); setFiltering(true); setOpen(true); }} />
      </div></PopoverAnchor>
      <PopoverContent className="p-0" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
        <CommandList>
          <CommandEmpty>{empty ?? '没有选项'}</CommandEmpty>
          <CommandGroup>{opts.map(option => <CommandItem key={option.value} value={option.value} onSelect={() => { onChange(option.value); setOpen(false); }}>
            <Check className={cx(value === option.value ? 'opacity-100' : 'opacity-0')} />
            <span>{option.label ?? option.value}{option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}</span>
          </CommandItem>)}</CommandGroup>
        </CommandList>
      </PopoverContent>
    </Popover>
  </Command>;
}

/** 搜索与分页属于业务数据；浮层和候选交互使用官方 Popover/Command。 */
export function AsyncSelect({ loadOptions, onChange, label, ariaLabel = label, disabled, id, triggerClassName, triggerIcon }: {
  loadOptions: OptionLoader; onChange: (value: string) => void;
  label: string; ariaLabel?: string; disabled?: boolean; id?: string; triggerClassName?: string; triggerIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 250);
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
    <PopoverTrigger asChild><Button type="button" id={id} variant="outline" role="combobox" aria-label={ariaLabel} aria-expanded={open}
      disabled={disabled} className={triggerClassName ?? 'w-full justify-between'}>
      {triggerIcon}<span title={label} className="min-w-0 truncate">{label}</span>{!triggerClassName && <ChevronDown />}
    </Button></PopoverTrigger>
    <PopoverContent className="w-[min(560px,calc(100vw-2rem))] p-0" aria-label={ariaLabel}>
      <Command shouldFilter={false}>
        <CommandInput aria-label="搜索规则文件" placeholder="搜索文件名或路径" value={query} onValueChange={setQuery} />
        {query !== debounced ? <div role="status" className="p-4 text-sm text-muted-foreground">搜索中…</div> : <PagedOptionList key={query} loadOptions={loadOptions} query={query} onSelect={value => { setOpen(false); onChange(value); }} />}
      </Command>
    </PopoverContent>
  </Popover>;
}
