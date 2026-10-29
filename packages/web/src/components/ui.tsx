// 基础组件：按设计稿的配色与尺寸（触控目标 ≥ 36–44px）。

import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';

// 宽、高、字号类在同一元素上冲突时，以后传入的为准（Tailwind 按样式表顺序而非 class 顺序生效）
const CONFLICT: [RegExp, string][] = [[/^w-/, 'w'], [/^h-/, 'h'], [/^text-(\[\d|xs$|sm$|base$|lg$|[2-9]?xl$)/, 'text-size']];
const conflictKey = (c: string) => {
  const i = c.lastIndexOf(':');
  const util = c.slice(i + 1);
  const hit = CONFLICT.find(([re]) => re.test(util));
  return hit && c.slice(0, i + 1) + hit[1];
};

export const cx = (...xs: (string | false | null | undefined)[]) => {
  const out: string[] = [];
  const at = new Map<string, number>();
  for (const c of xs.filter(Boolean).join(' ').split(/\s+/)) {
    if (!c) continue;
    const key = conflictKey(c);
    if (key && at.has(key)) { out[at.get(key)!] = c; continue; }
    if (key) at.set(key, out.length);
    out.push(c);
  }
  return out.join(' ');
};

type BtnVariant = 'primary' | 'default' | 'danger' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent border-accent text-white hover:bg-accent-strong',
  default: 'bg-panel border-[#d5d9e0] text-ink hover:bg-ground',
  danger: 'bg-panel border-[#f0b5ae] text-err hover:bg-err-soft',
  ghost: 'bg-transparent border-transparent text-ink-2 hover:bg-ground',
};

export function Button({ variant = 'default', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : 'h-10 px-3.5 text-[13.5px]',
        BTN[variant],
        className,
      )}
    />
  );
}

export const inputCls = 'h-[38px] w-full rounded-lg border border-[#d5d9e0] bg-panel px-3 text-[13px] text-ink placeholder:text-faint';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('w-full rounded-lg border border-[#d5d9e0] bg-panel px-3 py-2 text-[13px] text-ink', className)} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, 'pr-8', className)}>{children}</select>;
}

/** 带标签的表单项；children 为接收 id 的渲染函数 */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">{label}</label>
      {children(id)}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('rounded-[10px] border border-line bg-panel', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          {typeof title === 'string' ? <h2 className="m-0 text-[15px] font-semibold">{title}</h2> : title}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass ?? 'px-4 pb-4'}>{children}</div>
    </section>
  );
}

type Tone = 'ok' | 'warn' | 'err' | 'accent' | 'neutral';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  err: 'bg-err-soft text-err',
  accent: 'bg-accent-soft text-accent-ink',
  neutral: 'bg-[#ebedf1] text-ink-2',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-[#ebedf1] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-md px-3 text-[13px] cursor-pointer', o.value === value ? 'bg-panel font-medium shadow-[0_1px_2px_rgba(20,23,28,.08)]' : 'text-ink-2')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-[26px] w-11 shrink-0 rounded-full transition-colors cursor-pointer', checked ? 'bg-accent' : 'bg-[#c5cad3]')}>
      <span className={cx('absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left]', checked ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  );
}

export function PageHeader({ title, crumbs, actions, children }: { title: ReactNode; crumbs?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {crumbs && <div className="text-[12.5px] text-muted">{crumbs}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-[#8f2a1f]">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('w-full rounded-xl bg-panel shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line-2 px-5 py-3.5">
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md hover:bg-ground cursor-pointer"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** 渲染报告条目列表 */
export function ReportList({ items }: { items: { level: 'error' | 'warn' | 'info'; code: string; message: string; where?: string }[] }) {
  if (!items.length) return <div className="text-[13px] text-ok">没有问题</div>;
  const tone = { error: 'err', warn: 'warn', info: 'accent' } as const;
  const text = { error: '错误', warn: '告警', info: '提示' };
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {items.map((i, k) => (
        <li key={k} className="flex flex-col gap-1 border-b border-line-2 py-2.5 last:border-0">
          <span className="flex items-center gap-2"><Badge tone={tone[i.level]}>{text[i.level]}</Badge><span className="font-mono text-[11.5px] text-muted">{i.code}</span></span>
          <span className="text-[13px] leading-relaxed">{i.message}</span>
          {i.where && <span className="font-mono text-[11.5px] text-muted">{i.where}</span>}
        </li>
      ))}
    </ul>
  );
}

export const mono = 'font-mono';
export const th = 'border-b border-line px-3 py-2.5 text-left text-[12px] font-medium whitespace-nowrap text-muted';
export const td = 'border-b border-line-2 px-3 py-2.5 align-middle text-[13px]';

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(n?: number): string {
  if (n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
