import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogDescription, AlertDialogCancel } from './ui/alert-dialog.tsx';
// 详情页的平铺操作按钮与删除确认；删除按钮位于操作区最右侧。

import { useState, type ReactNode } from 'react';
import { deleteErrorText } from '../domain/deleteError.ts';
import { Button, ErrorAlert, } from './ui.tsx';

export type ActionItem = { label: string; onSelect: () => void };

/** 直接渲染到父级操作栏，按声明顺序排列并随操作栏换行。 */
export function ActionButtons({ items }: { items: ActionItem[] }) {
  return <>{items.map((item) => <Button key={item.label} onClick={item.onSelect}>{item.label}</Button>)}</>;
}

/** 删除确认：被引用时服务端拒绝，原因（含引用方）交给统一失败弹窗 */
export function DeleteDialog({ open, title, children, error, pending, onClose, onConfirm }: {
  open: boolean; title: string; children?: ReactNode; error?: unknown; pending?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const reason = deleteErrorText(error);
  return (
    <AlertDialog open={open} onOpenChange={next => { if (!next) (onClose)(); }}><AlertDialogContent className="max-h-[85dvh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle></AlertDialogHeader><AlertDialogDescription asChild><div className="flex flex-col gap-3.5">
      {children && <div className="text-[13.5px] leading-relaxed">{children}</div>}
      {open && <ErrorAlert error={error} />}
    </div></AlertDialogDescription><AlertDialogFooter>{<><AlertDialogCancel>取消</AlertDialogCancel><Button variant="danger-solid" disabled={pending || !!reason} onClick={onConfirm}>{pending ? '删除中…' : '删除'}</Button></>}</AlertDialogFooter></AlertDialogContent></AlertDialog>
  );
}

/** 详情页头部的独立「删除」按钮 + 删除确认 */
export function DeleteAction({ what, name, body, error, pending, onDelete, onReset }: {
  what: string; name: string; body?: ReactNode; error?: unknown; pending?: boolean; onDelete: () => void; onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="danger" onClick={() => { onReset?.(); setOpen(true); }}>删除</Button>
    <DeleteDialog open={open} title={`删除${what}「${name}」？`} error={error} pending={pending} onClose={() => setOpen(false)} onConfirm={onDelete}>
      {body ?? '删除后无法恢复。'}
    </DeleteDialog>
  </>;
}
