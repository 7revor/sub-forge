// 详情页的平铺操作按钮与删除确认；删除按钮位于操作区最右侧。

import { useState, type ReactNode } from 'react';
import { deleteErrorText } from '../domain/deleteError.ts';
import { Button, ErrorAlert, Modal } from './ui.tsx';

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
    <Modal alert title={title} open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="danger-solid" disabled={pending || !!reason} onClick={onConfirm}>{pending ? '删除中…' : '删除'}</Button></>}>
      {children && <div className="text-[13.5px] leading-relaxed">{children}</div>}
      {open && <ErrorAlert error={error} />}
    </Modal>
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
