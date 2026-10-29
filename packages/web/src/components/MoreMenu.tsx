// 详情页右上角的「更多」菜单与删除确认（设计稿「对话框与危险操作」）：删除不在页面底部放红色按钮。

import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteErrorText } from './DocList.tsx';
import { Button, Modal, cx } from './ui.tsx';

export type MoreItem = { label: string; danger?: boolean; onSelect: () => void };

export function MoreMenu({ items, label = '更多操作' }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const plain = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const item = (i: MoreItem) => <button key={i.label} type="button" role="menuitem" onClick={() => { setOpen(false); i.onSelect(); }}
    className={cx('h-9 cursor-pointer rounded-md px-2.5 text-left text-[13.5px]', i.danger ? 'text-err hover:bg-[#fdf4f3]' : 'hover:bg-ground')}>{i.label}</button>;
  return (
    <div ref={ref} className="relative">
      <Button aria-label={label} aria-haspopup="menu" aria-expanded={open} className="w-10 px-0" onClick={() => setOpen(!open)}><MoreHorizontal size={18} /></Button>
      {open && (
        <div role="menu" className="absolute top-[46px] right-0 z-30 flex w-[200px] flex-col rounded-[10px] border border-line bg-panel p-1.5 shadow-[0_8px_24px_rgba(20,23,28,.10)]">
          {plain.map(item)}
          {plain.length > 0 && danger.length > 0 && <div className="my-1 h-px bg-line-2" />}
          {danger.map(item)}
        </div>
      )}
    </div>
  );
}

/** 删除确认：被引用时服务端拒绝，原因（含引用方）显示在对话框里 */
export function DeleteDialog({ open, title, children, error, pending, onClose, onConfirm }: {
  open: boolean; title: string; children?: ReactNode; error?: unknown; pending?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const reason = deleteErrorText(error);
  return (
    <Modal title={title} open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button className="border-err bg-err text-white hover:bg-[#912018]" disabled={pending || !!reason} onClick={onConfirm}>{pending ? '删除中…' : '删除'}</Button></>}>
      {children && <div className="text-[13.5px] leading-relaxed">{children}</div>}
      {reason && <div role="alert" className="rounded-lg bg-err-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#8f2a1f]"><b>还不能删除：</b>{reason}</div>}
    </Modal>
  );
}

/** 「更多」菜单 + 删除确认的组合，供详情页头部使用 */
export function DeleteMenu({ what, name, body, error, pending, onDelete, onReset, extra = [] }: {
  what: string; name: string; body?: ReactNode; error?: unknown; pending?: boolean; onDelete: () => void; onReset?: () => void; extra?: MoreItem[];
}) {
  const [open, setOpen] = useState(false);
  return <>
    <MoreMenu items={[...extra, { label: '删除…', danger: true, onSelect: () => { onReset?.(); setOpen(true); } }]} />
    <DeleteDialog open={open} title={`删除${what}「${name}」？`} error={error} pending={pending} onClose={() => setOpen(false)} onConfirm={onDelete}>
      {body ?? '删除后无法恢复。'}
    </DeleteDialog>
  </>;
}
