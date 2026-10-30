import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { RepositoryUrlMatch } from '../hooks/useRepositoryUrlMatches.ts';
import { Button } from './ui.tsx';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover.tsx';

/** 悬停查看关联建议，点击固定浮层，键盘聚焦和触屏也能操作。 */
export function RepositoryMatchHint({ matches, busy, onLink, label = '发现可关联的仓库文件' }: {
  matches: RepositoryUrlMatch[]; busy: boolean; onLink: (match: RepositoryUrlMatch) => Promise<void>; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const show = () => { cancelClose(); setOpen(true); };
  const leave = () => {
    cancelClose();
    if (!pinned.current) timer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!matches.length) return null;
  return <Popover open={open} onOpenChange={next => { if (next) show(); else close(); }}>
    <PopoverAnchor asChild><button ref={anchor} type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show}
      onBlur={event => { if (!panel.current?.contains(event.relatedTarget)) close(); }}
      onClick={() => { cancelClose(); pinned.current = !pinned.current; setOpen(pinned.current); }}
      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-amber-500 hover:bg-amber-50">
      <TriangleAlert size={15} aria-hidden="true" />
    </button></PopoverAnchor>
    <PopoverContent ref={panel} id={id} align="start" sideOffset={6} collisionPadding={12} aria-label="仓库文件关联建议"
      className="w-[min(340px,calc(100vw-2rem))] p-3.5" onMouseEnter={show} onMouseLeave={leave}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) close(); }}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault(); }}>
      <p className="m-0 text-[13px] font-medium">可关联仓库文件</p>
      <p className="mt-1 mb-3 text-[12px] leading-5 text-ink-muted">此地址已收录在规则仓库中。关联后使用对应的仓库文件，保留规则顺序和出口。</p>
      <div className="flex max-h-[240px] flex-col gap-3 overflow-y-auto">
        {matches.map(match => <div key={`${match.repo}:${match.ref}:${match.path}`} className="flex min-w-0 flex-col items-start gap-2 border-t border-line-2 pt-2.5">
          <span className="break-all text-[12px] leading-5 text-ink-muted">{match.hint}</span>
          <Button size="sm" disabled={busy} onClick={async () => { await onLink(match); close(); }}>{busy ? '关联中…' : '关联仓库文件'}</Button>
        </div>)}
      </div>
    </PopoverContent>
  </Popover>;
}
