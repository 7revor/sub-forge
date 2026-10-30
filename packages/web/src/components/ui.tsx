// 基础组件：按设计稿的配色与尺寸（触控目标 ≥ 36–44px）。

import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { ReportItem } from '@sub-forge/core';
import { cn } from 'cn';

export { ErrorAlert } from './FeedbackHost.tsx';
export { Empty } from './Empty.tsx';
export { cx } from './cx.ts';
export { Select, Combobox, type SelectProps, type ComboOption } from './listbox.tsx';
import { cx } from './cx.ts';

type BtnVariant = 'primary' | 'default' | 'danger' | 'danger-solid' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-brand border-brand text-white hover:bg-accent-strong',
  default: 'bg-panel border-[#d5d9e0] text-ink hover:bg-ground',
  danger: 'bg-panel border-[#f0b5ae] text-err hover:bg-err-soft',
  'danger-solid': 'bg-err border-err text-white hover:bg-[#912018]',
  ghost: 'bg-transparent border-transparent text-ink-2 hover:bg-ground',
};

/** 按钮样式；链接需要长得像按钮时（如表格行的「编辑」）也用它 */
export const buttonClass = (variant: BtnVariant = 'default', size: 'sm' | 'md' = 'md', className?: string) => cn(
  'inline-flex items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap no-underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
  size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : 'h-10 px-3.5 text-[13.5px]',
  BTN[variant],
  className,
);

export function Button({ variant = 'default', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return <button type="button" {...p} className={buttonClass(variant, size, className)} />;
}

export const inputCls = 'h-[38px] w-full rounded-lg border border-[#d5d9e0] bg-panel px-3 text-[13px] text-ink placeholder:text-faint';

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement> & { placeholder: string }) {
  return <input {...p} className={cx(inputCls, className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { placeholder: string }) {
  return <textarea {...p} className={cx('w-full rounded-lg border border-[#d5d9e0] bg-panel px-3 py-2 text-[13px] text-ink', className)} />;
}

type DraftProps<E> = { value: string; onCommit: (value: string) => void; placeholder: string } & Omit<E, 'value' | 'onChange'>;

/** 只在失焦（或回车）时提交的输入框：输入过程只改本地草稿，避免每次按键都触发预览、命中数等反馈 */
export function DraftInput({ value, onCommit, onBlur, onKeyDown, ...p }: DraftProps<InputHTMLAttributes<HTMLInputElement>>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <Input {...p} value={draft}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={(e) => { if (draft !== value) onCommit(draft); onBlur?.(e); }}
    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); onKeyDown?.(e); }} />;
}

/** 同 DraftInput，多行版本（回车换行，只在失焦时提交） */
export function DraftTextarea({ value, onCommit, onBlur, ...p }: DraftProps<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <Textarea {...p} value={draft}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={(e) => { if (draft !== value) onCommit(draft); onBlur?.(e); }} />;
}

/** 带标签的表单项；children 为接收 id 的渲染函数 */
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-ink-muted">{label}</label>
      {children(id)}
      {hint && <span className="text-[12px] text-ink-muted">{hint}</span>}
    </div>
  );
}

/** 页面剩余展示区；同级的标题、筛选和操作栏保持固定。 */
export function PageScroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className="page-scroll"><div className={cx('page-scroll-content flex flex-col gap-5', className)}>{children}</div></div>;
}

export function Card({ title, subtitle, description, actions, children, className, bodyClass, scroll = false }: { title?: ReactNode; subtitle?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; scroll?: boolean }) {
  const panel = (
    <section className={cx('rounded-[10px] border border-line bg-panel', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5 pb-4">
          <div className="flex min-w-0 flex-col gap-0.5">{typeof title === 'string' ? <h2 className="m-0 text-[15px] font-semibold">{title}</h2> : title}{subtitle && <span className="text-[12.5px] text-ink-muted">{subtitle}</span>}</div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass ?? 'px-4 pb-4'}>
        {description && <p className="m-0 mb-4 text-[12.5px] leading-relaxed text-ink-muted">{description}</p>}
        {children}
      </div>
    </section>
  );
  return scroll ? <PageScroll>{panel}</PageScroll> : panel;
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

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit rounded-lg bg-[#ebedf1] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx('rounded-md px-3 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50', size === 'sm' ? 'h-[30px] text-[12.5px]' : 'h-8 text-[13px]', o.value === value ? 'bg-panel font-medium shadow-[0_1px_2px_rgba(20,23,28,.08)]' : 'text-ink-2')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" disabled={disabled} aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx('relative h-[26px] w-11 shrink-0 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-brand' : 'bg-[#c5cad3]')}>
      <span className={cx('absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left]', checked ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  );
}

export function PageHeader({ title, subtitle, crumbs, actions, children }: { title: ReactNode; subtitle?: ReactNode; crumbs?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="shrink-0 flex flex-col gap-2.5 break-words">
      {crumbs && <div className="text-[12.5px] text-ink-muted">{crumbs}</div>}
      <div className={cx('flex flex-wrap justify-between gap-3', subtitle ? 'items-end' : 'items-center')}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
            {children}
          </div>
          {subtitle && <p className="m-0 text-[13.5px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** 随输入变化的字段诊断，避免每次按键打断用户。 */
export function FieldError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-[#8f2a1f]">{error instanceof Error ? error.message : String(error)}</div>;
}

/** 渲染报告条目列表；定位入口保持为可键盘操作的按钮。 */
export function ReportList({ items, onLocate, canLocate = () => true, showWhere = true }: {
  items: ReportItem[];
  onLocate?: (where: string) => void; canLocate?: (where: string) => boolean;
  showWhere?: boolean;
}) {
  if (!items.length) return <div className="text-[13px] text-ok">没有问题</div>;
  const tone = { error: 'err', warn: 'warn', info: 'accent' } as const;
  const text = { error: '错误', warn: '告警', info: '提示' };
  return <ul className="m-0 flex list-none flex-col p-0">
    {items.map((item, index) => {
      const locate = !!onLocate && !!item.where && canLocate(item.where);
      if (item.ruleIssues?.length) return <li key={index} className="border-b border-line-2 py-2.5 last:border-0">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone={tone[item.level]}>{text[item.level]}</Badge><span>{item.message}</span>
          {locate && <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-brand" onClick={() => onLocate!(item.where!)}>定位规则</button>}
        </div>
        <details className="mt-1 text-[12px]">
          <summary className="w-fit cursor-pointer text-ink-muted">查看详情</summary>
          <div className="mt-2 max-h-64 overflow-auto overscroll-contain">
            {(['unimplemented', 'invalid'] as const).map(kind => {
              const issues = item.ruleIssues!.filter(issue => issue.kind === kind);
              return issues.length > 0 && <div key={kind} className="mb-2 last:mb-0">
                <strong>{kind === 'unimplemented' ? '类型不支持' : '写法有误'}</strong>
                {issues.map((issue, i) => <div key={i} className="mt-1 break-words text-ink-muted">来源 {issue.source} · 第 {issue.line} 行：{issue.reason}</div>)}
              </div>;
            })}
          </div>
        </details>
      </li>;
      const content = <>
        <span className="flex items-center gap-2"><Badge tone={tone[item.level]}>{text[item.level]}</Badge><span className="font-mono text-[11.5px] text-ink-muted">{item.code}</span></span>
        <span className="text-[13px] leading-relaxed">{item.message}</span>
        {item.where && (showWhere || locate) && <span className={locate ? 'text-[11.5px] text-brand' : 'font-mono text-[11.5px] text-ink-muted'}>{locate ? (showWhere ? `定位：${item.where}` : '定位') : item.where}</span>}
      </>;
      return <li key={index} className="border-b border-line-2 last:border-0">
        {locate ? <button type="button" className="flex w-full cursor-pointer flex-col gap-1 py-2.5 text-left hover:bg-ground" onClick={() => onLocate!(item.where!)}>{content}</button>
          : <div className="flex flex-col gap-1 py-2.5">{content}</div>}
      </li>;
    })}
  </ul>;
}

export const mono = 'font-mono';
/** 表格首尾与卡片标题栏保持相同的 16px 内边距。 */
export const th = 'first:pl-4 last:pr-4 border-b border-line px-3 py-2.5 text-left text-[12px] font-medium whitespace-nowrap text-ink-muted';
export const td = 'first:pl-4 last:pr-4 border-b border-line-2 px-3 py-2.5 align-middle text-[13px]';

export { formatTime, formatBytes } from '../utils/format.ts';

/** 服务端尚未实现的功能：界面已就位，操作会被服务端拒绝（501） */
export function PendingNotice({ children }: { children: ReactNode }) {
  return <div role="note" className="rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">{children}</div>;
}
