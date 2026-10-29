// 组合（设计稿「组合」）：有序引用多个节点集，成员可加前后缀；成员各自跑完处理链后合并，再跑组合自身的处理链（COL-01–04）。
// 详情页展示成员表、处理链摘要与合并后节点；处理链在单独的编辑页里逐步预览。

import type { Collection, NodeSetID } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { NodeSetPickerDialog, RenameDialog } from '../components/dialogs.tsx';
import { PipelineEditor, OP_LABEL, stepSummary } from '../components/PipelineEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { useNodeSetNames } from '../components/pickers.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, cx } from '../components/ui.tsx';
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
const GRID = 'grid grid-cols-[24px_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_32px] items-center gap-3 px-4';

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
  const preview = usePipelinePreview('collections', e.isNew ? undefined : e.id, e.draft?.pipeline);
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<Collection>) => e.setDraft({ ...d, ...p });
  const options = all.filter((n) => !(n.ref.type === 'collection' && n.ref.id === d.id));
  const shell = { listPath: '/collections', listLabel: '组合', isNew: e.isNew, name: d.name, dirty: e.dirty, saving: e.save.isPending, onSave: () => e.submit(), saveError: e.save.error };

  // 组合自身处理链的编辑页（逐步预览）
  if (tab === 'pipeline' && !e.isNew) {
    return (
      <DetailShell {...shell} name="处理链" listPath={`/collections/${d.id}`} listLabel={d.name}>
        <PipelineEditor steps={d.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})}
          inputLabel={`合并后 ${preview.data?.input ?? '—'} 个节点`} />
      </DetailShell>
    );
  }

  const usedBy = (profiles.data ?? []).filter((p) => p.nodeSets.some((n) => n.ref.type === 'collection' && n.ref.id === d.id));
  const out = preview.data?.nodes ?? [];
  return (
    <DetailShell {...shell} onDelete={e.remove} deleting={e.del.isPending} onDeleteReset={e.del.reset} deleteError={e.del.error}
      moreItems={[{ label: '重命名…', onSelect: () => setRenaming(true) }]}
      badges={<>
        <Badge>{d.members.length} 个成员{preview.data ? ` · 合并后 ${preview.data.input} 个节点` : ''}</Badge>
      </>}>
      {e.isNew && <Card title="名称"><Field label="名称">{(id) => <Input id={id} autoFocus value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field></Card>}

      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">成员</h2><span className="text-[12.5px] text-muted">按顺序合并。每个成员先跑自己的处理链，前后缀等价于自动追加一个改名处理器。组合之间不能成环。</span></div>}
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} />添加成员</Button>}
        bodyClass="overflow-x-auto pb-1">
        {!d.members.length ? <div className="px-4 pb-4 text-[13px] text-muted">还没有成员。点击「添加成员」选择订阅源、组合或本地节点组。</div> : (
          <div className="min-w-[760px]">
            <div className={cx(GRID, 'border-y border-line py-2 text-[12px] font-medium text-muted')}><span /><span>成员</span><span>类型</span><span>节点</span><span>前缀</span><span>后缀</span><span /></div>
            <SortableList items={d.members} onReorder={(members) => set({ members })} renderItem={(m, i, handle) => (
              <div className={cx(GRID, 'border-b border-line-2 py-2.5')}>
                {handle}
                <Link to={`/${m.ref.type === 'local' ? 'locals' : `${m.ref.type}s`}/${m.ref.id}`} className="truncate text-[13.5px] font-medium text-ink no-underline hover:text-accent">{nameOf(m.ref)}</Link>
                <span className="text-[12.5px] text-ink-2">{NS_LABEL[m.ref.type]}</span>
                <MemberCount refId={m.ref} />
                <Input aria-label={`${nameOf(m.ref)} 前缀`} className="h-[34px] font-mono text-[12.5px]" value={m.prefix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, prefix: x.target.value || undefined } : y)) })} />
                <Input aria-label={`${nameOf(m.ref)} 后缀`} className="h-[34px] font-mono text-[12.5px]" value={m.suffix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, suffix: x.target.value || undefined } : y)) })} />
                <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nameOf(m.ref)}`} onClick={() => set({ members: d.members.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
            )} />
          </div>
        )}
      </Card>

      {!e.isNew && (
        <div className="flex flex-wrap items-start gap-5">
          <section className="min-w-0 flex-[1_1_380px] rounded-[10px] border border-line bg-panel pt-3.5 pb-2">
            <div className="flex items-center justify-between px-4 pb-2.5">
              <h2 className="m-0 text-[15px] font-semibold">组合自身的处理链</h2>
              <span className="text-[12px] text-muted">在合并之后执行</span>
            </div>
            {d.pipeline.map((s, i) => {
              const t = preview.data?.trace[i];
              return (
                <div key={i} className={cx('flex items-center gap-3 border-t border-line-2 px-4 py-2.5', s.enabled === false && 'opacity-50')}>
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-[#ebedf1] font-mono text-[12px]">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{OP_LABEL[s.op]}</span><span className="truncate font-mono text-[12px] text-muted">{stepSummary(s)}</span></span>
                  {t && <span className="font-mono text-[12.5px] text-ink-2">{t.error ? '失败' : t.after}{!t.error && t.after !== t.before && <span className="text-err"> −{t.before - t.after}</span>}</span>}
                </div>
              );
            })}
            {!d.pipeline.length && <div className="border-t border-line-2 px-4 py-3 text-[13px] text-muted">没有处理步骤，合并结果原样输出（末尾仍会自动去重）。</div>}
            <div className="border-t border-line-2 px-4 pt-2.5 pb-1.5"><Link to={`/collections/${d.id}/pipeline`} className="text-[13px] text-accent">在处理链编辑器中打开（逐步预览）</Link></div>
          </section>

          <section className="flex min-w-0 flex-[999_1_480px] flex-col gap-3 rounded-[10px] border border-line bg-panel p-4">
            <h2 className="m-0 text-[15px] font-semibold">合并后节点{out.length > 16 ? '（前 16 个）' : ''}</h2>
            {preview.error ? <ErrorBox error={preview.error} /> : (
              <div className="flex flex-wrap gap-1.5">
                {out.slice(0, 16).map((n, i) => <span key={i} title={`${n.type} ${n.server}:${n.port}`} className="rounded-md border border-line bg-ground px-2 py-1 font-mono text-[12px]">{n.name}</span>)}
                {!out.length && <span className="text-[13px] text-muted">{preview.isFetching ? '合并中…' : '没有节点'}</span>}
              </div>
            )}
            <span className="text-[12.5px] text-muted">被哪些配置订阅使用：{usedBy.length ? usedBy.map((p, i) => <span key={p.id}>{i > 0 && '、'}<Link to={`/profiles/${p.id}`} className="text-accent">{p.name}</Link></span>) : '还没有'}</span>
          </section>
        </div>
      )}

      <NodeSetPickerDialog open={adding} title="添加成员" options={options} added={d.members.map((m) => m.ref)} onClose={() => setAdding(false)}
        onAdd={(refs) => set({ members: [...d.members, ...refs.map((ref) => ({ ref }))] })} hint="不能加入会形成环的组合；保存时会再次检查。" />
      <RenameDialog open={renaming} title="重命名组合" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => set({ name })} />
    </DetailShell>
  );
}
