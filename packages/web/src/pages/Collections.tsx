// 组合：有序引用多个节点集，成员可加前后缀；成员各自跑完处理链后合并，再跑组合自身的处理链（COL-01–04）。

import type { Collection, NodeSetID } from '@sub-forge/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { NodeSetSelect, useNodeSetNames } from '../components/pickers.tsx';
import { Button, Card, Empty, ErrorBox, Field, Input, td, th } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { usePipelinePreview } from './Sources.tsx';

export function CollectionList() {
  return (
    <DocList kind="collections" title="组合" intro="把多个订阅源、组合或本地节点组按顺序合并成一个节点集，可整体加入配置订阅。"
      columns={[
        { header: '名称', cell: (c) => c.name },
        { header: '成员', cell: (c) => <span className="font-mono">{c.members.length}</span> },
        { header: '处理链', cell: (c) => <span className="font-mono">{c.pipeline.length} 步</span> },
      ]} />
  );
}

const EMPTY: Collection = { id: '', name: '', members: [], pipeline: [] };

export function CollectionEdit() {
  const e = useDocEditor('collections', EMPTY);
  const { all, nameOf } = useNodeSetNames();
  const [adding, setAdding] = useState<NodeSetID>();
  const preview = usePipelinePreview('collections', e.isNew ? undefined : e.id, e.draft?.pipeline);
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const set = (p: Partial<Collection>) => e.setDraft({ ...d, ...p });
  const options = all.filter((n) => !(n.ref.type === 'collection' && n.ref.id === d.id));
  const move = (i: number, dir: -1 | 1) => {
    const m = [...d.members];
    const [x] = m.splice(i, 1);
    m.splice(i + dir, 0, x!);
    set({ members: m });
  };

  return (
    <DetailShell listPath="/collections" listLabel="组合" isNew={e.isNew} name={d.name} dirty={e.dirty} saving={e.save.isPending}
      onSave={() => e.submit()} saveError={e.save.error} onDelete={() => e.remove(d.name)} deleteError={e.del.error}>
      <Card title="基本信息"><Field label="名称">{(id) => <Input id={id} value={d.name} onChange={(x) => set({ name: x.target.value })} />}</Field></Card>
      <Card title={<div className="flex flex-col gap-0.5"><h2 className="m-0 text-[15px] font-semibold">成员</h2><span className="text-[12.5px] text-muted">按顺序合并；前后缀等价于自动追加一个改名处理器，避免多源同名。组合之间不能成环。</span></div>}
        actions={<div className="flex gap-2"><div className="w-56"><NodeSetSelect label="要加入的成员" value={adding} options={options} onChange={setAdding} /></div>
          <Button disabled={!adding} onClick={() => { if (adding) { set({ members: [...d.members, { ref: adding }] }); setAdding(undefined); } }}><Plus size={15} />加入</Button></div>}
        bodyClass="overflow-x-auto">
        {!d.members.length ? <div className="px-4 pb-4"><Empty>还没有成员。</Empty></div> : (
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><th className={th}>顺序</th><th className={th}>成员</th><th className={th}>前缀</th><th className={th}>后缀</th><th className={th} /></tr></thead>
            <tbody>
              {d.members.map((m, i) => (
                <tr key={`${m.ref.type}:${m.ref.id}:${i}`}>
                  <td className={td}><div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                    <Button size="sm" variant="ghost" aria-label="下移" disabled={i === d.members.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                  </div></td>
                  <td className={`${td} font-medium`}>{nameOf(m.ref)}</td>
                  <td className={td}><Input aria-label="前缀" className="h-9 font-mono" value={m.prefix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, prefix: x.target.value || undefined } : y)) })} /></td>
                  <td className={td}><Input aria-label="后缀" className="h-9 font-mono" value={m.suffix ?? ''} onChange={(x) => set({ members: d.members.map((y, j) => (j === i ? { ...y, suffix: x.target.value || undefined } : y)) })} /></td>
                  <td className={`${td} text-right`}><Button size="sm" variant="ghost" aria-label="移除成员" onClick={() => set({ members: d.members.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {e.isNew ? <Card title="组合自身的处理链"><p className="m-0 text-[13px] text-muted">保存后即可编辑处理链并逐步预览。</p></Card> : (
        <PipelineEditor steps={d.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})}
          inputLabel={`合并后 ${preview.data?.input ?? '—'} 个节点`} />
      )}
    </DetailShell>
  );
}
