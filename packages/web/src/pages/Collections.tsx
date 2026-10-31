import { ActionMenu } from '../components/ActionMenu.tsx';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { NODE_SET_LABEL, nodeSetPath } from '../domain/nodeSet.ts';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
// 组合（设计稿「组合」）：有序引用多个节点集，成员可加前后缀；成员各自跑完处理链后合并，再跑组合自身的处理链（COL-01–04）。
// 详情页与订阅源一致：成员表下方直接展开组合自身的处理链编辑器，逐步预览合并结果。

import type { Collection } from '@sub-forge/core';
import { Plus, Layers, Server, Monitor } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';
import { DetailShell } from '../components/DetailShell.tsx';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { NodeSetPickerDialog } from '../components/dialogs.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { useNodeSetNames } from '../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorAlert, Field, Input, Select, cx, listMono } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList } from '../hooks.ts';
import { usePipelinePreview } from '../hooks/usePipelinePreview.ts';

export function CollectionList() {
  return (
    <DocList kind="collections" title="节点组合"
      columns={[
        { header: '名称', cell: (c) => c.name },
        { header: '备注', cell: (c) => <NoteCell note={c.note} /> },
        { header: '成员', width: 80, cell: (c) => <span className={listMono}>{c.members.length}</span> },
        { header: '处理链', width: 88, cell: (c) => <span className={listMono}>{c.pipeline.length} 步</span> },
      ]} />
  );
}

// 成员行：拖动手柄、成员、类型、节点数、前缀、后缀、移除
const GRID = 'grid grid-cols-[20px_32px_minmax(0,1fr)_28px] lg:grid-cols-[20px_32px_minmax(0,1fr)_160px_160px_28px] items-center gap-3 rounded-[10px] border border-line px-4 py-2';

const EMPTY: Collection = { id: '', name: '', members: [], pipeline: [] };

export function CollectionEdit() {
  const { tab } = useParams();
  const e = useDocEditor('collections', EMPTY);
  const { all, nameOf } = useNodeSetNames();
  const profiles = useList('profiles');
  const preview = usePipelinePreview('collections', e.isNew ? undefined : e.id, e.draft?.pipeline, e.draft?.members);
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<Collection>) => e.setDraft({ ...d, ...p });
  const options = all.filter((n) => !(n.ref.type === 'collection' && n.ref.id === d.id));
  const shell = { listPath: '/collections', listLabel: '节点组合', isNew: e.isNew, name: d.name, dirty: e.dirty, saving: e.save.isPending, onSave: () => e.submit(), saveError: e.save.error };

  // 旧的独立处理链编辑页已并入详情页
  if (tab === 'pipeline' && !e.isNew) return <Navigate to={`/collections/${d.id}`} replace />;

  const usedBy = (profiles.data ?? []).filter((p) => p.nodeSets.some((n) => n.ref.type === 'collection' && n.ref.id === d.id));
  return (
    <DetailShell {...shell} onDelete={e.remove} onDeleted={e.afterRemove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      extraActions={!e.isNew && <ResourceLinkButton kind="collections" id={d.id} name={d.name} disabled={e.dirty} />}
      actionItems={[{ label: '重命名', onSelect: async () => { const result = await Frame.modal.prompt({ title: '重命名组合', initialValue: d.name, unchangedValue: d.name, placeholder: '填写新的组合名称' }); if (result.status === 'confirmed') set({ name: result.data }); } }]}
      badges={<>
        <Badge>{d.members.length} 个成员{preview.data ? ` · 合并后 ${preview.data.input} 个节点` : ''}</Badge>
        {!e.isNew && <Badge>被配置订阅使用：{usedBy.length ? usedBy.map((p, i) => <span key={p.id}>{i > 0 && '、'}<Link to={`/profiles/${p.id}`} className="text-brand">{p.name}</Link></span>) : '还没有'}</Badge>}
      </>}>
      <Card bodyClass="grid gap-4 p-5 sm:grid-cols-[1fr_2fr]">
        {<Field label="名称">{(id) => <Input placeholder="填写节点组合的名称" id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>}
        <NoteField compact value={d.note} onChange={(note) => set({ note })} />
      </Card>

      <Card title="成员" count={d.members.length}
        actions={<Button onClick={async () => { const result = await NodeSetPickerDialog.show({ title: '添加成员', options, added: d.members.map(m => m.ref), hint: '组合不能循环引用。' }); if (result.status === 'confirmed') set({ members: [...d.members, ...result.data.map(ref => ({ ref }))] }); }}><Plus size={15} />添加成员</Button>}
        bodyClass="px-5 pb-5">
        {!d.members.length ? <div className="px-4 pb-4"><Empty title="还没有成员" /></div> : (
          <div>
            <SortableList items={d.members} onReorder={(members) => set({ members })} renderItem={(m, i, handle) => (
              <div className={GRID}>
                {handle}<span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-brand">{m.ref.type === 'source' ? <Server size={16} /> : m.ref.type === 'local' ? <Monitor size={16} /> : <Layers size={16} />}</span>
                <div className="min-w-0"><Link to={nodeSetPath(m.ref)} className="truncate text-[length:var(--text-control)] font-medium text-ink no-underline hover:text-brand">{nameOf(m.ref)}</Link><div className="mt-0.5 flex items-center gap-1 text-[length:var(--text-caption)] text-ink-muted">{NODE_SET_LABEL[m.ref.type]} · <NodeSetCount nodeSet={m.ref} /></div></div>
                <Input placeholder="名称前缀" aria-label={`${nameOf(m.ref)} 前缀`} className="col-span-2 row-start-2 h-8 lg:col-auto lg:row-auto" value={m.prefix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, prefix: x.target.value || undefined } : y)) })} />
                <Input placeholder="名称后缀" aria-label={`${nameOf(m.ref)} 后缀`} className="col-span-2 row-start-2 h-8 lg:col-auto lg:row-auto" value={m.suffix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, suffix: x.target.value || undefined } : y)) })} />
                <div className="col-start-4 row-start-1 lg:col-auto lg:row-auto"><ActionMenu label={`${nameOf(m.ref)}更多操作`} items={[
                  { label: '失败处理', onSelect: async () => { const result = await MemberOptionsModal.show({ name: nameOf(m.ref), onFail: m.onFail }); if (result.status === 'confirmed') set({ members: d.members.map((y, j) => j === i ? { ...y, onFail: result.data } : y) }); } },
                  { label: '移除成员', danger: true, onSelect: () => set({ members: d.members.filter((_, j) => j !== i) }) },
                ]} /></div>
              </div>
            )} />
          </div>
        )}

      </Card>

      {!e.isNew && (
        <PipelineEditor compactOverview title="处理链" steps={d.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})}
          inputLabel={`在合并之后执行 · 合并后 ${preview.data?.input ?? '—'} 个节点`} />
      )}


    </DetailShell>
  );
}

const MemberOptionsModal = createModal<{ name: string; onFail?: 'snapshot' | 'skip' | 'fail' }, 'snapshot' | 'skip' | 'fail' | undefined>(function MemberOptions({ data, modal }) {
  const [value, setValue] = useModalDraft(data.onFail);
  return <ModalContent aria-describedby={undefined}><ModalHeader><ModalTitle>{data.name} · 失败处理</ModalTitle></ModalHeader>
    <Field label="拉取失败时" hint="失败策略暂不生效，当前统一使用上次成功的快照。">{id => <Select id={id} clearable placeholder="选择拉取失败时的处理方式" value={value ?? ''} onChange={event => setValue(event.target.value as typeof value || undefined)}><option value="snapshot">使用快照</option><option value="skip">跳过该成员</option><option value="fail">整体失败</option></Select>}</Field>
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" onClick={() => modal.confirm(value)}>保存</Button></ModalFooter></ModalContent>;
});
