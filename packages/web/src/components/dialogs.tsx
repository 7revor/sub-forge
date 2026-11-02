import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { matchesNameSearch } from '@sub-forge/core';
import { NODE_SET_LABEL, sameNodeSet as same, nodeSetKey } from '../domain/nodeSet.ts';
// 通用对话框（设计稿「对话框与危险操作」）：重命名、添加节点集。

import type { NodeSetID } from '@sub-forge/core';
import { Button, Empty } from './ui.tsx';
import { SearchInput } from './SearchInput.tsx';
import { Checkbox } from './ui/checkbox.tsx';

/** 搜索 + 多选；已加入的置灰，不能自选（如组合不能加入自己） */
export const NodeSetPickerDialog = createModal<{ title?: string; options: { ref: NodeSetID; name: string }[]; added: NodeSetID[]; hint?: string }, NodeSetID[]>(function NodeSetModal({ data: { title = '添加节点来源', options, added, hint }, modal }) {
  const [q, setQ] = useModalDraft('');
  const [picked, setPicked] = useModalDraft<NodeSetID[]>([]);
  const onClose = modal.cancel;
  const onAdd = modal.confirm;
  const shown = options.filter((o) => matchesNameSearch(o.name, q));
  return (
    <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>{title}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-3">
      <SearchInput className="max-w-none" aria-label="搜索节点来源" placeholder="搜索订阅源、组合、本地节点组" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-lg border border-border">
        {(['source', 'collection', 'local'] as const).map(type => <div key={type}>{shown.some(o => o.ref.type === type) && <div className="bg-muted px-3 py-1.5 text-xs text-muted-foreground">{NODE_SET_LABEL[type]}</div>}{shown.filter(o => o.ref.type === type).map((o) => {
          const isAdded = added.some((a) => same(a, o.ref));
          const on = picked.some((p) => same(p, o.ref));
          return (
            <label key={nodeSetKey(o.ref)} className={`flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-0 ${isAdded ? 'text-muted-foreground' : on ? 'cursor-pointer bg-primary/5' : 'cursor-pointer hover:bg-accent'}`}>
              <Checkbox disabled={isAdded} checked={on || isAdded} onCheckedChange={(value) => setPicked(value === true ? [...picked, o.ref] : picked.filter((p) => !same(p, o.ref)))} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</span>
              <span className="text-xs text-muted-foreground">{isAdded ? '已加入' : NODE_SET_LABEL[o.ref.type]}</span>
            </label>
          );
        })}</div>)}
        {!shown.length && <div className="p-3"><Empty title={options.length ? '没有匹配的节点来源' : '还没有可添加的节点来源'} /></div>}
      </div>
      {hint && <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>}
    </div><ModalFooter>{<><span className="mr-auto text-xs text-muted-foreground">已选 {picked.length}</span><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!picked.length} onClick={() => { onAdd(picked); }}>添加</Button></>}</ModalFooter></ModalContent>
  );
});
