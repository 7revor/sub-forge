import { alertError } from '../feedback.ts';
import { Empty } from './Empty.tsx';
// 下拉选择组件：所有下拉都用这里的 Select / Combobox，不使用浏览器自带的 <select> 弹层与 <datalist>（见仓库 CLAUDE.md）。
// 弹层渲染到 body，避免被卡片、表格的 overflow 裁掉；层级高于对话框。

import { ChevronDown } from 'lucide-react';
import {
  Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type HTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.ts';

const fieldCls = 'h-[38px] w-full rounded-lg border border-[#d5d9e0] bg-panel px-3 text-[13px] text-ink';

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

/** 跟随触发元素定位的弹层：下方空间不够时翻到上方，滚动、缩放时重新定位 */
function usePopoverPos(anchor: RefObject<HTMLElement | null>, open: boolean, preferredWidth?: number) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < 200 && above > below;
      const width = preferredWidth ? Math.min(preferredWidth, window.innerWidth - 16) : r.width;
      const left = preferredWidth ? Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) : r.left;
      setPos({ left, width, maxHeight: Math.min(300, up ? above : below) - 4, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, open, preferredWidth]);
  return pos;
}

function useOutside(refs: RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!refs.some((r) => r.current?.contains(e.target as Node))) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });
}

function OptionList({ id, opts, active, selected, pos, listRef, label, onPick, onHover, empty }: {
  id: string; opts: Opt[]; active: number; selected?: string | readonly string[]; pos: NonNullable<ReturnType<typeof usePopoverPos>>; listRef: RefObject<HTMLDivElement | null>;
  label?: string; onPick: (o: Opt) => void; onHover: (i: number) => void; empty?: ReactNode;
}) {
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, listRef]);
  const isSelected = (value: string) => typeof selected === 'string' ? selected === value : selected?.includes(value);
  return createPortal(
    <div ref={listRef} id={id} role="listbox" aria-label={label} aria-multiselectable={Array.isArray(selected) || undefined}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxHeight: pos.maxHeight }}
      className="fixed z-[60] max-w-[min(480px,calc(100vw-16px))] overflow-y-auto rounded-[10px] border border-line bg-panel p-1.5 shadow-[0_8px_24px_rgba(20,23,28,.12)]"
      onMouseDown={(e) => e.preventDefault()}>
      {!opts.length && <Empty size="compact" title={empty ?? '没有选项'} />}
      {opts.map((o, i) => <Fragment key={`${o.group ?? ''}\u0000${o.value}\u0000${i}`}>
        {o.group && o.group !== opts[i - 1]?.group && <div role="presentation" className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-faint">{o.group}</div>}
        <div id={`${id}-${i}`} data-i={i} role="option" aria-selected={isSelected(o.value) ?? false} aria-disabled={o.disabled || undefined}
          onMouseEnter={() => onHover(i)} onClick={() => !o.disabled && onPick(o)}
          className={cx('flex min-h-9 cursor-pointer flex-col justify-center rounded-md px-2.5 py-1.5 text-[13px]',
            i === active && 'bg-ground', isSelected(o.value) && 'font-medium text-accent-ink', o.disabled && 'cursor-not-allowed opacity-45')}>
          <span className="truncate">{Array.isArray(selected) && <span aria-hidden="true" className="mr-2">{isSelected(o.value) ? '✓' : '　'}</span>}{o.label}</span>
          {o.hint && <span className="truncate text-[11.5px] font-normal text-muted">{o.hint}</span>}
        </div>
      </Fragment>)}
    </div>,
    document.body,
  );
}

export type SelectProps = Omit<HTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> & {
  value?: string | number; onChange?: (e: { target: { value: string } }) => void; disabled?: boolean; children?: ReactNode; placeholder?: string;
};

/** 单选下拉。子节点写法与原生 select 相同（option / optgroup），option 可用 data-hint 加一行说明；onChange 收到 { target: { value } } */
export function Select({ value, onChange, disabled, children, placeholder = '请选择', className, id, onKeyDown, ...rest }: SelectProps) {
  const opts = collect(children);
  const current = value == null ? '' : String(value);
  const selIdx = opts.findIndex((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pos = usePopoverPos(btn, open);
  const typed = useRef({ s: '', t: 0 });
  useOutside([btn, list], open, () => setOpen(false));

  const enabled = (i: number) => { const o = opts[i]; return !!o && !o.disabled; };
  const show = () => { setActive(selIdx >= 0 ? selIdx : opts.findIndex((o) => !o.disabled)); setOpen(true); };
  const pick = (o: Opt) => { setOpen(false); btn.current?.focus(); if (o.value !== current) onChange?.({ target: { value: o.value } }); };
  const step = (from: number, dir: 1 | -1) => { for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (enabled(i)) return i; return from; };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e);
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(opts.length, -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = opts[active]; if (o && !o.disabled) pick(o); }
    else if (e.key.length === 1) {
      // 键入首字母跳转
      const now = Date.now();
      typed.current = { s: (now - typed.current.t < 600 ? typed.current.s : '') + e.key.toLowerCase(), t: now };
      const hit = opts.findIndex((o, i) => enabled(i) && o.text.toLowerCase().startsWith(typed.current.s));
      if (hit >= 0) setActive(hit);
    }
  };

  const sel = opts[selIdx];
  return <>
    <button {...rest} ref={btn} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} disabled={disabled}
      onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}
      className={cx(fieldCls, 'inline-flex min-w-0 cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint', open && 'border-accent', className)}>
      <span className={cx('min-w-0 flex-1 truncate', !sel && 'text-faint')}>{sel ? sel.label : placeholder}</span>
      <ChevronDown size={15} aria-hidden className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
    </button>
    {open && pos && <OptionList id={listId} opts={opts} active={active} selected={current} pos={pos} listRef={list} label={rest['aria-label']} onPick={pick} onHover={setActive} />}
  </>;
}

export type ComboOption = { value: string; label?: ReactNode; hint?: ReactNode };

/** 多选下拉，点击选项切换勾选；空字符串选项清空所有选择。 */
export function MultiSelect({ value, onChange, children, placeholder = '请选择', className, id, disabled, ...rest }: Omit<SelectProps, 'value' | 'onChange'> & {
  value: string[]; onChange: (value: string[]) => void;
}) {
  const opts = collect(children);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pos = usePopoverPos(btn, open);
  useOutside([btn, list], open, () => setOpen(false));
  const pick = (option: Opt) => {
    if (option.disabled) return;
    onChange(!option.value ? [] : value.includes(option.value) ? value.filter(item => item !== option.value) : [...value, option.value]);
    btn.current?.focus();
  };
  const step = (direction: 1 | -1) => {
    for (let i = active + direction; i >= 0 && i < opts.length; i += direction) if (!opts[i]?.disabled) { setActive(i); return; }
  };
  return <>
    <button {...rest} id={id} ref={btn} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        rest.onKeyDown?.(event);
        if (disabled) return;
        if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true); return; }
        if (!open) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (event.key === 'Tab') setOpen(false);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); step(event.key === 'ArrowDown' ? 1 : -1); }
        else if (event.key === 'Home') { event.preventDefault(); setActive(Math.max(0, opts.findIndex(option => !option.disabled))); }
        else if (event.key === 'End') { event.preventDefault(); setActive(opts.findLastIndex(option => !option.disabled)); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (opts[active]) pick(opts[active]); }
      }}
      className={cx(fieldCls, 'inline-flex min-w-0 cursor-pointer items-center gap-2 text-left disabled:opacity-50', open && 'border-accent', className)}>
      <span className="min-w-0 flex-1 truncate">{value.length ? opts.filter(option => value.includes(option.value)).map(option => option.text).join('、') : placeholder}</span>
      <ChevronDown size={15} aria-hidden className={cx('shrink-0 text-muted', open && 'rotate-180')} />
    </button>
    {open && pos && <OptionList id={listId} opts={opts} active={active} selected={value.length ? value : ['']} pos={pos} listRef={list} label={rest['aria-label']} onPick={pick} onHover={setActive} />}
  </>;
}

/** 可输入的下拉：输入框里可以填列表中没有的值，弹层按输入内容筛选候选项（替代 datalist） */
export function Combobox({ value, onChange, options, className, placeholder, disabled, empty, ...rest }: Omit<HTMLAttributes<HTMLInputElement>, 'onChange'> & {
  value: string; onChange: (v: string) => void; options: ComboOption[]; placeholder?: string; disabled?: boolean; empty?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pos = usePopoverPos(input, open);
  useOutside([input, list], open, () => setOpen(false));
  const q = filtering ? value.trim().toLowerCase() : '';
  const opts: Opt[] = options.map((o) => ({ value: o.value, label: o.label ?? o.value, text: o.value, hint: o.hint }))
    .filter((o) => !q || o.text.toLowerCase().includes(q));
  const pick = (o: Opt) => { setOpen(false); onChange(o.value); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      setActive((a) => Math.max(0, Math.min(opts.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && opts[active]) { e.preventDefault(); pick(opts[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return <>
    <div className={cx('relative min-w-0', className)}>
      <input {...rest} ref={input} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 && opts[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" disabled={disabled} placeholder={placeholder} value={value}
        onFocus={() => { setFiltering(false); setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setFiltering(true); setActive(0); setOpen(true); }}
        onKeyDown={onKey}
        className={cx(fieldCls, 'pr-8 placeholder:text-faint', open && 'border-accent')} />
      <ChevronDown size={15} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
    </div>
    {open && pos && <OptionList id={listId} opts={opts} active={active} selected={value} pos={pos} listRef={list} label={rest['aria-label']} onPick={pick} onHover={setActive} empty={empty} />}
  </>;
}

export type AsyncSelectOption = { value: string; label: string; hint?: string };
export type AsyncSelectPage = { options: AsyncSelectOption[]; nextOffset?: number; notices?: string[] };

/** 懒加载单选：打开才请求，搜索防抖并隔离旧响应；分页追加，不允许提交任意文本。 */
export function AsyncSelect({ loadOptions, onChange, placeholder = '请选择', disabled, triggerClassName, triggerIcon, searchLabel = '搜索仓库规则', searchPlaceholder = '搜索规则名或路径', ...rest }: {
  loadOptions: (query: string, offset: number) => Promise<AsyncSelectPage>;
  onChange: (value: string) => void;
  placeholder?: string; disabled?: boolean; 'aria-label': string; id?: string;
  searchLabel?: string; searchPlaceholder?: string;
  triggerClassName?: string; triggerIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [page, setPage] = useState<AsyncSelectPage>({ options: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const btn = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pos = usePopoverPos(btn, open, 420);
  const close = () => { setOpen(false); btn.current?.focus(); };
  // 全局错误对话框盖在选择器上方；确认错误后仍应能在原位置重试。
  useOutside([btn, popup], open, () => { if (!document.querySelector('[role="alertdialog"]')) setOpen(false); });
  useEffect(() => {
    const version = ++generation.current;
    setPage({ options: [] }); setActive(-1); setError('');
    busy.current = false;
    if (!open) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      busy.current = true;
      loadOptions(query, 0).then(result => {
        if (generation.current === version) { setPage(result); setActive(result.options.length ? 0 : -1); }
      }).catch(e => { if (generation.current === version) { setError(e instanceof Error ? e.message : String(e)); alertError(e); } })
        .finally(() => { if (generation.current === version) { busy.current = false; setLoading(false); } });
    }, query ? 300 : 0);
    return () => { clearTimeout(timer); generation.current++; };
  }, [open, query, retry, loadOptions]);
  useEffect(() => { popup.current?.querySelector(`[data-option="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const more = async () => {
    if (busy.current || page.nextOffset === undefined) return;
    const version = generation.current;
    busy.current = true; setLoading(true); setError('');
    try {
      const next = await loadOptions(query, page.nextOffset);
      if (generation.current === version) setPage(p => ({ ...next, options: [...p.options, ...next.options] }));
    } catch (e) { if (generation.current === version) { setError(e instanceof Error ? e.message : String(e)); alertError(e); } }
    finally { if (generation.current === version) { busy.current = false; setLoading(false); } }
  };
  const pick = (value: string) => { close(); onChange(value); };
  return <>
    <button ref={btn} id={rest.id} type="button" role="combobox" aria-label={rest['aria-label']} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? `${listId}-popup` : undefined} disabled={disabled}
      className={triggerClassName ?? cx(fieldCls, 'inline-flex items-center gap-2 text-left disabled:opacity-50')}
      onClick={() => { setQuery(''); setOpen(!open); }}
      onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); } }}>
      {triggerIcon}<span className={cx('min-w-0', !triggerClassName && 'flex-1 truncate')}>{placeholder}</span>{!triggerClassName && <ChevronDown size={15} />}
    </button>
    {open && pos && createPortal(<div ref={popup} id={`${listId}-popup`} role="dialog" aria-label={rest['aria-label']}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-[10px] border border-line bg-panel shadow-[0_8px_24px_rgba(20,23,28,.12)]"
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'Tab') setOpen(false);
      }}>
      <div className="shrink-0 border-b border-line-2 p-3">
        <input autoFocus role="combobox" aria-label={searchLabel} aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={query} placeholder={searchPlaceholder} className={cx(fieldCls, 'shrink-0')}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, Math.min(page.options.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1)))); }
            if (e.key === 'Enter') { e.preventDefault(); if (page.options[active]) pick(page.options[active]!.value); }
          }} />
      </div>
      {!!page.notices?.length && <div role="status" className="shrink-0 border-b border-line-2 px-3 py-2 text-[12px] text-muted">{page.notices.join('；')}</div>}
      <div id={listId} role="listbox" aria-label={`${searchLabel}候选`} aria-busy={loading} className="min-h-0 overflow-y-auto overscroll-contain p-1.5 empty:hidden"
        onScroll={e => { const el = e.currentTarget; if (!error && el.scrollHeight - el.scrollTop - el.clientHeight < 32) void more(); }}>
        {page.options.map((o, i) => <div key={o.value} id={`${listId}-${i}`} data-option={i} role="option" aria-selected={i === active}
          onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}
          className={cx('flex min-h-12 cursor-pointer flex-col justify-center gap-0.5 rounded-md px-3 py-2 text-[13px]', i === active && 'bg-ground')}>
          <div className="truncate">{o.label}</div><div className="truncate text-[11.5px] text-muted">{o.hint}</div>
        </div>)}
      </div>
      {(loading || error || page.nextOffset !== undefined || !page.options.length) && <div role="status" className="flex min-h-12 shrink-0 items-center justify-center gap-2 border-t border-line-2 px-3 py-2 text-center text-[12px] text-muted">
        {loading ? '加载中…' : error ? <><span>加载失败</span><button type="button" className="shrink-0 rounded-md px-2 py-1 text-accent-ink hover:bg-ground" onClick={() => page.options.length ? void more() : setRetry(x => x + 1)}>重试</button></> : page.nextOffset !== undefined ? <button type="button" className="w-full cursor-pointer rounded-md py-1 text-accent-ink hover:bg-ground" onClick={() => void more()}>加载更多</button> : '没有匹配的规则'}
      </div>}
    </div>, document.body)}
  </>;
}
