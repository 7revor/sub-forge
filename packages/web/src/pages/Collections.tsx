import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { NODE_SET_LABEL, nodeSetPath } from '../domain/nodeSet.ts';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
// 组合（设计稿「组合」）：有序引用多个节点集，成员可加前后缀；成员各自跑完处理链后合并，再跑组合自身的处理链（COL-01–04）。
// 详情页与订阅源一致：成员表下方直接展开组合自身的处理链编辑器，逐步预览合并结果。

import type { Collection } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
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
    <DocList kind="collections" title="组合"
      columns={[
        { header: '名称', cell: (c) => c.name },
        { header: '备注', cell: (c) => <NoteCell note={c.note} /> },
        { header: '成员', width: 80, cell: (c) => <span className={listMono}>{c.members.length}</span> },
        { header: '处理链', width: 88, cell: (c) => <span className={listMono}>{c.pipeline.length} 步</span> },
      ]} />
  );
}

// 成员行：拖动手柄、成员、类型、节点数、前缀、后缀、移除
const GRID = 'grid grid-cols-[24px_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_32px] items-center gap-3 px-4';

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
  const shell = { listPath: '/collections', listLabel: '组合', isNew: e.isNew, name: d.name, dirty: e.dirty, saving: e.save.isPending, onSave: () => e.submit(), saveError: e.save.error };

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
      <Card title="基本信息">
        {e.isNew && <Field label="名称">{(id) => <Input placeholder="填写节点组合的名称" id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field>}
        <NoteField value={d.note} onChange={(note) => set({ note })} />
      </Card>

      <Card title={`成员`}
        actions={<Button onClick={async () => { const result = await NodeSetPickerDialog.show({ title: '添加成员', options, added: d.members.map(m => m.ref), hint: '组合不能循环引用。' }); if (result.status === 'confirmed') set({ members: [...d.members, ...result.data.map(ref => ({ ref }))] }); }}><Plus size={15} />添加成员</Button>}
        bodyClass="overflow-x-auto pb-1">
        {!d.members.length ? <div className="px-4 pb-4"><Empty title="还没有成员" /></div> : (
          <div className="min-w-[900px]">
            <div className={cx(GRID, 'border-y border-line py-2 text-[12px] font-medium text-ink-muted')}><span /><span>成员</span><span>类型</span><span>节点</span><span>前缀</span><span>后缀</span><span>拉取失败时</span><span /></div>
            <SortableList items={d.members} onReorder={(members) => set({ members })} renderItem={(m, i, handle) => (
              <div className={cx(GRID, 'border-b border-line-2 py-2.5')}>
                {handle}
                <Link to={nodeSetPath(m.ref)} className="truncate text-[13.5px] font-medium text-ink no-underline hover:text-brand">{nameOf(m.ref)}</Link>
                <span className="text-[12.5px] text-ink-2">{NODE_SET_LABEL[m.ref.type]}</span>
                <NodeSetCount nodeSet={m.ref} />
                <Input placeholder="添加到节点名称开头的文字" aria-label={`${nameOf(m.ref)} 前缀`} className="h-[34px] font-mono text-[12.5px]" value={m.prefix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, prefix: x.target.value || undefined } : y)) })} />
                <Input placeholder="添加到节点名称末尾的文字" aria-label={`${nameOf(m.ref)} 后缀`} className="h-[34px] font-mono text-[12.5px]" value={m.suffix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, suffix: x.target.value || undefined } : y)) })} />
                <Select placeholder="选择拉取失败时使用快照或中断" aria-label={`${nameOf(m.ref)} 拉取失败时`} className="h-[34px] text-[12.5px]" value={m.onFail ?? 'snapshot'}
                  onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, onFail: x.target.value as 'snapshot' | 'skip' | 'fail' } : y)) })}>
                  <option value="snapshot">使用快照</option><option value="skip">跳过该成员</option><option value="fail">整体失败</option>
                </Select>
                <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nameOf(m.ref)}`} onClick={() => set({ members: d.members.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
            )} />
          </div>
        )}
        {d.members.length > 0 && <p className="mx-4 mt-2 mb-3 text-[12px] text-ink-muted">失败策略暂不生效，拉取失败时使用快照。</p>}
      </Card>

      {!e.isNew && (
        <PipelineEditor title="组合自身的处理链" steps={d.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})}
          inputLabel={`在合并之后执行 · 合并后 ${preview.data?.input ?? '—'} 个节点`} />
      )}


    </DetailShell>
  );
}
