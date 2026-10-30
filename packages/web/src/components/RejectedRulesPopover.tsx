import { useEffect, useId, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover.tsx';
import type { RulesetSourceStatus } from '../api.ts';
import { Badge } from './ui.tsx';

/** 来源解析诊断：悬停临时显示，点击固定；弹层放到 body，避免滚动容器裁切。 */
export function RejectedRulesPopover({ sourceName, status }: { sourceName: string; status: RulesetSourceStatus }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const details = status.rejectedDetails ?? [];
  const cancelClose = () => { clearTimeout(timer.current); };
  const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const show = () => { cancelClose(); setOpen(true); };
  const leave = () => {
    cancelClose();
    if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  return <Popover open={open} onOpenChange={next => { if (next) show(); else close(); }}>
    <PopoverAnchor asChild><button ref={anchor} type="button" aria-label={`${sourceName}：未解析 ${status.rejected} 行，查看详情`}
      aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      onClick={() => { cancelClose(); pinned.current = !pinned.current; setOpen(pinned.current); }}
      className="cursor-pointer rounded-full border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <Badge tone="warn">已解析 {status.rules} 条 · 未解析 {status.rejected} 行</Badge>
    </button></PopoverAnchor>
    <PopoverContent ref={panel} id={id} role="region" aria-label={`${sourceName} 未解析的规则`} align="end" sideOffset={6} collisionPadding={12}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault(); }}
      onEscapeKeyDown={() => anchor.current?.focus()}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      style={{ maxHeight: 'min(360px, var(--radix-popover-content-available-height))' }}
      className="w-[min(520px,calc(100vw-24px))] overflow-auto overscroll-contain p-3.5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <strong className="min-w-0 break-all text-[13px]">{sourceName} · 未解析 {status.rejected} 行</strong>
        <button type="button" aria-label="关闭规则详情" className="shrink-0 cursor-pointer border-0 bg-transparent text-[12px] text-ink-muted hover:text-ink"
          onClick={() => { anchor.current?.focus(); close(); }}>关闭</button>
      </div>
      <div className="flex flex-col gap-3">
        {details.map((r, i) => <div key={`${r.line}-${i}`} className="min-w-0 border-t border-line-2 pt-2 text-[12px]">
          <div className="mb-1 text-ink-muted">第 {r.line} 行 · {r.reason.includes('不支持') ? `本系统暂未支持解析：${r.reason}` : `输入格式有误：${r.reason}`} </div>
          <code className="block whitespace-pre-wrap break-all rounded bg-ground p-2 font-mono">{r.text}</code>
        </div>)}
        {!details.length && <span className="text-[12px] text-ink-muted">暂无详情，请刷新预览后重试。</span>}
        {!!details.length && details.length < (status.rejected ?? 0) && <span className="text-[12px] text-ink-muted">显示前 {details.length} 行，共 {status.rejected} 行。</span>}
      </div>
    </PopoverContent>
  </Popover>;
}
