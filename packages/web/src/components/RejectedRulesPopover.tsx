import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>();
  const details = status.rejectedDetails ?? [];
  const cancelClose = () => { clearTimeout(timer.current); };
  const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const show = () => { cancelClose(); setOpen(true); };
  const leave = () => {
    cancelClose();
    if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(520, window.innerWidth - 24);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 240 && above > below;
      setPos({ width, left: Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12)),
        maxHeight: Math.max(80, Math.min(360, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node && (anchor.current?.contains(target) || panel.current?.contains(target));
    const outside = (e: PointerEvent) => { if (!inside(e.target)) close(); };
    const focus = (e: FocusEvent) => { if (!inside(e.target)) close(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (panel.current?.contains(document.activeElement)) anchor.current?.focus();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return <>
    <button ref={anchor} type="button" aria-label={`${sourceName}：未解析 ${status.rejected} 行，查看详情`}
      aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      onClick={() => { cancelClose(); pinned.current = !pinned.current; setOpen(pinned.current); }}
      className="cursor-pointer rounded-full border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <Badge tone="warn">已解析 {status.rules} 条 · 未解析 {status.rejected} 行</Badge>
    </button>
    {open && pos && createPortal(<div ref={panel} id={id} role="region" aria-label={`${sourceName} 未解析的规则`} style={pos}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      className="fixed z-[80] overflow-auto overscroll-contain rounded-lg border border-line bg-panel p-3.5 text-ink shadow-xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <strong className="min-w-0 break-all text-[13px]">{sourceName} · 未解析 {status.rejected} 行</strong>
        <button type="button" aria-label="关闭规则详情" className="shrink-0 cursor-pointer border-0 bg-transparent text-[12px] text-muted hover:text-ink"
          onClick={() => { anchor.current?.focus(); close(); }}>关闭</button>
      </div>
      <div className="flex flex-col gap-3">
        {details.map((r, i) => <div key={`${r.line}-${i}`} className="min-w-0 border-t border-line-2 pt-2 text-[12px]">
          <div className="mb-1 text-muted">第 {r.line} 行 · {r.reason.includes('不支持') ? `本系统暂未支持解析：${r.reason}` : `输入格式有误：${r.reason}`} </div>
          <code className="block whitespace-pre-wrap break-all rounded bg-ground p-2 font-mono">{r.text}</code>
        </div>)}
        {!details.length && <span className="text-[12px] text-muted">暂无详情，请刷新预览后重试。</span>}
        {!!details.length && details.length < (status.rejected ?? 0) && <span className="text-[12px] text-muted">显示前 {details.length} 行，共 {status.rejected} 行。</span>}
      </div>
    </div>, document.body)}
  </>;
}
