// 通用对话框（设计稿「对话框与危险操作」）：重命名、添加节点集。

import type { NodeSetID } from '@sub-forge/core';
import { useEffect, useState } from 'react';
import { Button, Input, Modal } from './ui.tsx';

export function RenameDialog({ open, title, name, onClose, onRename }: { open: boolean; title: string; name: string; onClose: () => void; onRename: (name: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => { if (open) setValue(name); }, [open, name]);
  const ok = !!value.trim() && value.trim() !== name;
  return (
    <Modal title={title} open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!ok} onClick={() => { onRename(value.trim()); onClose(); }}>确定</Button></>}>
      <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">名称</span>
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) { onRename(value.trim()); onClose(); } }} /></label>
      <span className="text-[12px] text-muted">改名后点击页面右上角「保存」生效。</span>
    </Modal>
  );
}

const NS_LABEL = { source: '订阅源', collection: '组合', local: '本地节点组' } as const;
const same = (a: NodeSetID, b: NodeSetID) => a.type === b.type && a.id === b.id;

/** 搜索 + 多选；已加入的置灰，不能自选（如组合不能加入自己） */
export function NodeSetPickerDialog({ open, title = '添加节点集', options, added, onClose, onAdd, hint }: {
  open: boolean; title?: string; options: { ref: NodeSetID; name: string }[]; added: NodeSetID[];
  onClose: () => void; onAdd: (refs: NodeSetID[]) => void; hint?: string;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<NodeSetID[]>([]);
  useEffect(() => { if (open) { setQ(''); setPicked([]); } }, [open]);
  const shown = options.filter((o) => !q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title={title} open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!picked.length} onClick={() => { onAdd(picked); onClose(); }}>加入 {picked.length || ''} 个</Button></>}>
      <Input aria-label="搜索节点集" placeholder="搜索订阅源、组合、本地节点组" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-lg border border-line">
        {shown.map((o) => {
          const isAdded = added.some((a) => same(a, o.ref));
          const on = picked.some((p) => same(p, o.ref));
          return (
            <label key={`${o.ref.type}:${o.ref.id}`} className={`flex items-center gap-2.5 border-b border-line-2 px-3 py-2.5 last:border-0 ${isAdded ? 'text-faint' : 'cursor-pointer hover:bg-ground'}`}>
              <input type="checkbox" disabled={isAdded} checked={on || isAdded} onChange={(e) => setPicked(e.target.checked ? [...picked, o.ref] : picked.filter((p) => !same(p, o.ref)))} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{o.name}</span>
              <span className="text-[12px] text-muted">{isAdded ? '已加入' : NS_LABEL[o.ref.type]}</span>
            </label>
          );
        })}
        {!shown.length && <div className="px-3 py-4 text-center text-[13px] text-muted">{options.length ? '没有匹配的节点集' : '还没有可加入的节点集'}</div>}
      </div>
      {hint && <span className="text-[12px] leading-relaxed text-muted">{hint}</span>}
    </Modal>
  );
}
