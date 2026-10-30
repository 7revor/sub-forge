import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { matchesNameSearch } from '@sub-forge/core';
import { NODE_SET_LABEL, sameNodeSet as same, nodeSetKey } from '../domain/nodeSet.ts';
// 通用对话框（设计稿「对话框与危险操作」）：重命名、添加节点集。

import type { NodeSetID } from '@sub-forge/core';
import { Button, Empty } from './ui.tsx';
import { SearchInput } from './SearchInput.tsx';

/** 搜索 + 多选；已加入的置灰，不能自选（如组合不能加入自己） */
export const NodeSetPickerDialog = createModal<{ title?: string; options: { ref: NodeSetID; name: string }[]; added: NodeSetID[]; hint?: string }, NodeSetID[]>(function NodeSetModal({ data: { title = '添加节点集', options, added, hint }, modal }) {
  const [q, setQ] = useModalDraft('');
  const [picked, setPicked] = useModalDraft<NodeSetID[]>([]);
  const onClose = modal.cancel;
  const onAdd = modal.confirm;
  const shown = options.filter((o) => matchesNameSearch(o.name, q));
  return (
    <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>{title}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-3.5">
      <SearchInput aria-label="搜索节点集" placeholder="搜索订阅源、组合、本地节点组" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-lg border border-line">
        {shown.map((o) => {
          const isAdded = added.some((a) => same(a, o.ref));
          const on = picked.some((p) => same(p, o.ref));
          return (
            <label key={nodeSetKey(o.ref)} className={`flex items-center gap-2.5 border-b border-line-2 px-3 py-2.5 last:border-0 ${isAdded ? 'text-faint' : 'cursor-pointer hover:bg-ground'}`}>
              <input type="checkbox" disabled={isAdded} checked={on || isAdded} onChange={(e) => setPicked(e.target.checked ? [...picked, o.ref] : picked.filter((p) => !same(p, o.ref)))} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{o.name}</span>
              <span className="text-[12px] text-ink-muted">{isAdded ? '已加入' : NODE_SET_LABEL[o.ref.type]}</span>
            </label>
          );
        })}
        {!shown.length && <div className="p-3"><Empty title={options.length ? '没有匹配的节点集' : '还没有可加入的节点集'} /></div>}
      </div>
      {hint && <span className="text-[12px] leading-relaxed text-ink-muted">{hint}</span>}
    </div><ModalFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!picked.length} onClick={() => { onAdd(picked); }}>加入 {picked.length || ''} 个</Button></>}</ModalFooter></ModalContent>
  );
});
