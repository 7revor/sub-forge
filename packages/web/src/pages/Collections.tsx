// 组合（设计稿「组合」）：有序引用多个节点集，成员可加前后缀；成员各自跑完处理链后合并，再跑组合自身的处理链（COL-01–04）。
// 详情页与订阅源一致：成员表下方直接展开组合自身的处理链编辑器，逐步预览合并结果。

import type { Collection, NodeSetID } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { NodeSetPickerDialog, RenameDialog } from '../components/dialogs.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { useNodeSetNames } from '../components/pickers.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList, useNodeList } from '../hooks.ts';
import { usePipelinePreview } from './Sources.tsx';

export function CollectionList() {
  return (
    <DocList kind="collections" title="组合" empty="把多个订阅源、本地节点组合并成一个节点集，成员可以加前后缀区分来源。" intro="把多个订阅源、组合或本地节点组按顺序合并成一个节点集，可整体加入配置订阅。"
      columns={[
        { header: '名称', cell: (c) => c.name },
        { header: '成员', cell: (c) => <span className="font-mono">{c.members.length}</span> },
        { header: '处理链', cell: (c) => <span className="font-mono">{c.pipeline.length} 步</span> },
      ]} />
  );
}

const NS_LABEL = { source: '订阅源', collection: '组合', local: '本地节点组' } as const;
// 成员行：拖动手柄、成员、类型、节点数、前缀、后缀、移除
const GRID = 'grid grid-cols-[24px_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_32px] items-center gap-3 px-4';

function MemberCount({ refId }: { refId: NodeSetID }) {
  const nodes = useNodeList(refId);
  return <span className="font-mono text-[12.5px]">{nodes.data ? nodes.data.total : '—'}</span>;
}

const EMPTY: Collection = { id: '', name: '', members: [], pipeline: [] };

export function CollectionEdit() {
  const { tab } = useParams();
  const e = useDocEditor('collections', EMPTY);
  const { all, nameOf } = useNodeSetNames();
  const profiles = useList('profiles');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const preview = usePipelinePreview('collections', e.isNew ? undefined : e.id, e.draft?.pipeline, e.draft?.members);
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<Collection>) => e.setDraft({ ...d, ...p });
  const options = all.filter((n) => !(n.ref.type === 'collection' && n.ref.id === d.id));
  const shell = { listPath: '/collections', listLabel: '组合', isNew: e.isNew, name: d.name, dirty: e.dirty, saving: e.save.isPending, onSave: () => e.submit(), saveError: e.save.error };

  // 旧的独立处理链编辑页已并入详情页
  if (tab === 'pipeline' && !e.isNew) return <Navigate to={`/collections/${d.id}`} replace />;

  const usedBy = (profiles.data ?? []).filter((p) => p.nodeSets.some((n) => n.ref.type === 'collection' && n.ref.id === d.id));
  return (
    <DetailShell {...shell} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      moreItems={[{ label: '重命名…', onSelect: () => setRenaming(true) }]}
      badges={<>
        <Badge>{d.members.length} 个成员{preview.data ? ` · 合并后 ${preview.data.input} 个节点` : ''}</Badge>
        {!e.isNew && <Badge>被配置订阅使用：{usedBy.length ? usedBy.map((p, i) => <span key={p.id}>{i > 0 && '、'}<Link to={`/profiles/${p.id}`} className="text-accent">{p.name}</Link></span>) : '还没有'}</Badge>}
      </>}>
      {e.isNew && <Card title="名称"><Field label="名称">{(id) => <Input id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field></Card>}

      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">成员</h2><span className="text-[12.5px] text-muted">按顺序合并。每个成员先跑自己的处理链，前后缀等价于自动追加一个改名处理器。组合之间不能成环。</span></div>}
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} />添加成员</Button>}
        bodyClass="overflow-x-auto pb-1">
        {!d.members.length ? <div className="px-4 pb-4 text-[13px] text-muted">还没有成员。点击「添加成员」选择订阅源、组合或本地节点组。</div> : (
          <div className="min-w-[900px]">
            <div className={cx(GRID, 'border-y border-line py-2 text-[12px] font-medium text-muted')}><span /><span>成员</span><span>类型</span><span>节点</span><span>前缀</span><span>后缀</span><span>拉取失败时</span><span /></div>
            <SortableList items={d.members} onReorder={(members) => set({ members })} renderItem={(m, i, handle) => (
              <div className={cx(GRID, 'border-b border-line-2 py-2.5')}>
                {handle}
                <Link to={`/${m.ref.type === 'local' ? 'locals' : `${m.ref.type}s`}/${m.ref.id}`} className="truncate text-[13.5px] font-medium text-ink no-underline hover:text-accent">{nameOf(m.ref)}</Link>
                <span className="text-[12.5px] text-ink-2">{NS_LABEL[m.ref.type]}</span>
                <MemberCount refId={m.ref} />
                <Input aria-label={`${nameOf(m.ref)} 前缀`} className="h-[34px] font-mono text-[12.5px]" value={m.prefix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, prefix: x.target.value || undefined } : y)) })} />
                <Input aria-label={`${nameOf(m.ref)} 后缀`} className="h-[34px] font-mono text-[12.5px]" value={m.suffix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, suffix: x.target.value || undefined } : y)) })} />
                <Select aria-label={`${nameOf(m.ref)} 拉取失败时`} className="h-[34px] text-[12.5px]" value={m.onFail ?? 'snapshot'}
                  onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, onFail: x.target.value as 'snapshot' | 'skip' | 'fail' } : y)) })}>
                  <option value="snapshot">使用快照</option><option value="skip">跳过该成员</option><option value="fail">整体失败</option>
                </Select>
                <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nameOf(m.ref)}`} onClick={() => set({ members: d.members.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
            )} />
          </div>
        )}
        {d.members.length > 0 && <p className="mx-4 mt-2 mb-3 text-[12px] text-muted">「拉取失败时」会随组合保存；服务端渲染尚未读取这一项，目前成员拉取失败时一律使用快照。</p>}
      </Card>

      {!e.isNew && (
        <PipelineEditor title="组合自身的处理链" steps={d.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})}
          inputLabel={`在合并之后执行 · 合并后 ${preview.data?.input ?? '—'} 个节点`} />
      )}

      <NodeSetPickerDialog open={adding} title="添加成员" options={options} added={d.members.map((m) => m.ref)} onClose={() => setAdding(false)}
        onAdd={(refs) => set({ members: [...d.members, ...refs.map((ref) => ({ ref }))] })} hint="不能加入会形成环的组合；保存时会再次检查。" />
      <RenameDialog open={renaming} title="重命名组合" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => set({ name })} />
    </DetailShell>
  );
}
