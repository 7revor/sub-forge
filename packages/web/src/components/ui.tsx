// 基础组件：直接使用 shadcn/ui 组件，只做业务所需的薄包装（必填 placeholder、tone 映射等），不覆盖其默认样式。

import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { ReportItem } from '@sub-forge/core';
import { cn } from 'cn';
import { Button as ShadcnButton, buttonVariants } from './ui/button.tsx';
import { Input as ShadcnInput } from './ui/input.tsx';
import { Textarea as ShadcnTextarea } from './ui/textarea.tsx';
import { Label } from './ui/label.tsx';
import { Badge as ShadcnBadge } from './ui/badge.tsx';
import { Switch as ShadcnSwitch } from './ui/switch.tsx';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group.tsx';
import { Card as ShadcnCard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.tsx';
import { Alert, AlertDescription } from './ui/alert.tsx';

export { ErrorAlert } from './FeedbackHost.tsx';
export { Empty } from './Empty.tsx';
export { cx } from './cx.ts';
export { Select, Combobox, type SelectProps, type ComboOption } from './listbox.tsx';
import { cx } from './cx.ts';

type BtnVariant = 'primary' | 'default' | 'danger' | 'danger-solid' | 'ghost';
/** 业务语义 → shadcn 变体；danger 为描边按钮加危险色文字，其余完全沿用 shadcn。 */
const VARIANT = { primary: 'default', default: 'outline', danger: 'outline', 'danger-solid': 'destructive', ghost: 'ghost' } as const;
const SIZE = { sm: 'sm', md: 'default', icon: 'icon', 'icon-sm': 'icon-sm' } as const;
type BtnSize = keyof typeof SIZE;

/** 按钮样式；链接需要长得像按钮时（如表格行的「编辑」）也用它 */
export const buttonClass = (variant: BtnVariant = 'default', size: BtnSize = 'md', className?: string) =>
  cn(buttonVariants({ variant: VARIANT[variant], size: SIZE[size] }), variant === 'danger' && 'text-destructive hover:text-destructive', className);

export function Button({ variant = 'default', size = 'md', className, type = 'button', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <ShadcnButton type={type} {...p} variant={VARIANT[variant]} size={SIZE[size]} className={cn(variant === 'danger' && 'text-destructive hover:text-destructive', className)} />;
}

export function Input(p: InputHTMLAttributes<HTMLInputElement> & { placeholder: string }) {
  return <ShadcnInput {...p} />;
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement> & { placeholder: string }) {
  return <ShadcnTextarea {...p} />;
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
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="m-0 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 页面剩余展示区；同级的标题、筛选和操作栏保持固定。 */
export function PageScroll({ children, className, contained = false }: { children: ReactNode; className?: string; contained?: boolean }) {
  return <div className={cx('page-scroll', contained && 'page-scroll-contained')}><div className={cx('page-scroll-content flex flex-col gap-5', className)}>{children}</div></div>;
}

export function Card({ title, count, subtitle, description, actions, children, className, bodyClass, scroll = false }: { title?: ReactNode; count?: number; subtitle?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; scroll?: boolean }) {
  const panel = (
    <ShadcnCard className={className}>
      {(title || actions) && <CardHeader>
        {title && <CardTitle className={actions ? 'whitespace-nowrap' : undefined}>{title}{count !== undefined && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{count}</span>}</CardTitle>}
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
        {actions && <CardAction className="flex flex-wrap gap-2">{actions}</CardAction>}
      </CardHeader>}
      <CardContent className={bodyClass}>
        {description && <p className="m-0 mb-4 text-sm text-muted-foreground">{description}</p>}
        {children}
      </CardContent>
    </ShadcnCard>
  );
  return scroll ? <PageScroll>{panel}</PageScroll> : panel;
}

type Tone = 'ok' | 'warn' | 'err' | 'accent' | 'neutral';
/** 状态色是 shadcn 未内置的唯一扩展：成功 / 告警使用浅底语义色，其余映射到 shadcn Badge 变体。 */
const TONE_VARIANT = { ok: 'outline', warn: 'outline', err: 'destructive', accent: 'default', neutral: 'secondary' } as const;
const TONE_CLASS: Partial<Record<Tone, string>> = { ok: 'border-transparent bg-ok-soft text-ok', warn: 'border-transparent bg-warn-soft text-warn' };

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <ShadcnBadge variant={TONE_VARIANT[tone]} className={cn(TONE_CLASS[tone], className)}>{children}</ShadcnBadge>;
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', fullWidth = false }: {
  value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; fullWidth?: boolean;
}) {
  return <ToggleGroup type="single" variant="outline" size={size === 'sm' ? 'sm' : 'default'} aria-label={label} value={value}
    onValueChange={next => { if (next) onChange(next as T); }} className={cn('self-start', fullWidth && 'w-full')}>
    {options.map(o => <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} title={o.title} aria-label={o.label} className={cn('px-3', fullWidth && 'flex-1')}>{o.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <ShadcnSwitch checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} />;
}

/** 列表行内的布尔项用分段控件，两种状态都有明确文案；value 为 true 时选中 on。 */
export function BooleanSegmented({ value, onChange, label, on, off, disabled = false, size = 'sm' }: {
  value: boolean; onChange: (v: boolean) => void; label: string; on: string; off: string; disabled?: boolean; size?: 'sm' | 'md';
}) {
  return <Segmented label={label} size={size} value={value ? 'on' : 'off'} onChange={next => onChange(next === 'on')}
    options={[{ value: 'on', label: on, disabled }, { value: 'off', label: off, disabled }]} />;
}

export function PageHeader({ title, subtitle, crumbs, actions, children }: { title: ReactNode; subtitle?: ReactNode; crumbs?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="shrink-0 flex flex-col gap-2 break-words">
      {crumbs && <div className="text-xs text-muted-foreground">{crumbs}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-2xl font-semibold">{title}</h1>
            {children}
            {subtitle && <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** 随输入变化的字段诊断，避免每次按键打断用户。 */
export function FieldError({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription></Alert>;
}

/** 渲染报告条目列表；定位入口保持为可键盘操作的按钮。 */
export function ReportList({ items, onLocate, canLocate = () => true, showWhere = true }: {
  items: ReportItem[];
  onLocate?: (where: string) => void; canLocate?: (where: string) => boolean;
  showWhere?: boolean;
}) {
  if (!items.length) return <div className="text-sm text-ok">没有问题</div>;
  const tone = { error: 'err', warn: 'warn', info: 'accent' } as const;
  const text = { error: '错误', warn: '告警', info: '提示' };
  return <ul className="m-0 flex list-none flex-col p-0">
    {items.map((item, index) => {
      const locate = !!onLocate && !!item.where && canLocate(item.where);
      if (item.ruleIssues?.length) return <li key={index} className="border-b border-border py-2.5 last:border-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={tone[item.level]}>{text[item.level]}</Badge><span>{item.message}</span>
          {locate && <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-primary" onClick={() => onLocate!(item.where!)}>定位规则</button>}
        </div>
        <details className="mt-1 text-xs">
          <summary className="w-fit cursor-pointer text-muted-foreground">查看详情</summary>
          <div className="mt-2 max-h-64 overflow-auto overscroll-contain">
            {(['unimplemented', 'invalid'] as const).map(kind => {
              const issues = item.ruleIssues!.filter(issue => issue.kind === kind);
              return issues.length > 0 && <div key={kind} className="mb-2 last:mb-0">
                <strong>{kind === 'unimplemented' ? '类型不支持' : '写法有误'}</strong>
                {issues.map((issue, i) => <div key={i} className="mt-1 break-words text-muted-foreground">来源 {issue.source} · 第 {issue.line} 行：{issue.reason}</div>)}
              </div>;
            })}
          </div>
        </details>
      </li>;
      const content = <>
        <span className="flex items-center gap-2"><Badge tone={tone[item.level]}>{text[item.level]}</Badge><span className="font-mono text-xs text-muted-foreground">{item.code}</span></span>
        <span className="text-sm leading-relaxed">{item.message}</span>
        {item.where && (showWhere || locate) && <span className={locate ? 'text-xs text-primary' : 'font-mono text-xs text-muted-foreground'}>{locate ? (showWhere ? `定位：${item.where}` : '定位') : item.where}</span>}
      </>;
      return <li key={index} className="border-b border-border last:border-0">
        {locate ? <button type="button" className="flex w-full cursor-pointer flex-col gap-1 py-2.5 text-left hover:bg-muted" onClick={() => onLocate!(item.where!)}>{content}</button>
          : <div className="flex flex-col gap-1 py-2.5">{content}</div>}
      </li>;
    })}
  </ul>;
}

export const mono = 'font-mono';
export const listMono = 'font-mono';

export { formatTime, formatBytes } from '../utils/format.ts';

/** 服务端尚未实现的功能：界面已就位，操作会被服务端拒绝（501） */
export function PendingNotice({ children }: { children: ReactNode }) {
  return <Alert role="note"><AlertDescription>{children}</AlertDescription></Alert>;
}
