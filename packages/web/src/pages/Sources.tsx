// 订阅源：列表 + 新建对话框（设计稿「列表页」）、处理链编辑器（「订阅源 · 编辑处理步骤」）、
// 拉取参数与快照历史对话框（「订阅源 · 拉取参数与快照」）。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperatorStep } from '@sub-forge/core';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { api, type PipelinePreview } from '../api.ts';
import { DocList } from '../components/DocList.tsx';
import { DeleteDialog, MoreMenu } from '../components/MoreMenu.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { Badge, Button, ErrorBox, Input, Modal, PageHeader, Segmented, Textarea, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useDeleteDoc, useDoc, useNodeList, useSaveDoc, useSourceFetchState, type SourceDoc } from '../hooks.ts';

function SourceNodes({ source }: { source: SourceDoc }) {
  const nodes = useNodeList({ type: 'source', id: source.id });
  return <span className="font-mono text-[13px]">{nodes.data ? nodes.data.nodes.length : '—'}</span>;
}

function SourceState({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  if (!s.remote) return <Badge tone="ok">正常</Badge>;
  if (s.failing) return <Badge tone="err">{s.lastOk ? '拉取失败 · 使用快照' : '拉取失败'}</Badge>;
  return s.lastOk ? <Badge tone="ok">正常</Badge> : <Badge>未拉取</Badge>;
}

function SourceLast({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  return <span className="text-ink-2">{s.lastOk ? formatTime(s.lastOk.fetchedAt).slice(5) : '—'}</span>;
}

const kindText = (s: SourceDoc) => (s.kind === 'remote' ? `远程 · ${s.urls?.length ?? 0} 个地址` : '本地内容');

export function SourceList() {
  const location = useLocation();
  const [creating, setCreating] = useState(!!(location.state as { create?: boolean } | null)?.create);
  return (
    <>
      <DocList kind="sources" title="订阅源" noun="订阅源" onCreate={() => setCreating(true)}
        intro="节点来源：远程订阅地址或粘贴的本地内容。改名、过滤、排序都写在处理链里。"
        empty="添加机场的订阅地址，或粘贴自己整理的节点。之后在处理链里改名、过滤、排序。"
        columns={[
          { header: '名称', cell: (s) => s.name },
          { header: '类型', cell: (s) => <span className="text-ink-2">{kindText(s)}</span> },
          { header: '节点', cell: (s) => <SourceNodes source={s} /> },
          { header: '处理链', cell: (s) => <span className="font-mono text-[13px]">{s.pipeline.length} 步</span> },
          { header: '上次拉取', cell: (s) => <SourceLast source={s} /> },
          { header: '状态', cell: (s) => <SourceState source={s} /> },
        ]} />
      <NewSourceModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function NewSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveDoc('sources');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SourceDoc['kind']>('remote');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const ready = name.trim() && (kind === 'remote' ? url.trim() : content.trim());
  const create = () => save.mutate(
    kind === 'remote' ? { name: name.trim(), kind, urls: [url.trim()], pipeline: [] } : { name: name.trim(), kind, content, pipeline: [] },
    { onSuccess: (item) => navigate(`/sources/${item.id}`, { state: { justCreated: kind === 'remote' } }) },
  );
  return (
    <Modal title="新建订阅源" open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!ready || save.isPending} onClick={create}>{save.isPending ? '创建中…' : '创建并编辑处理链'}</Button></>}>
      <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">名称</span><Input autoFocus placeholder="例如：机场 A" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">类型</span>
        <Segmented label="类型" value={kind} options={[{ value: 'remote', label: '远程订阅' }, { value: 'local', label: '本地内容' }]} onChange={setKind} /></div>
      {kind === 'remote'
        ? <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">订阅地址</span><Input className="font-mono" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        : <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">内容（URI 列表、Base64、Clash YAML 或 Surge [Proxy] 段）</span><Textarea rows={6} className="font-mono text-[12.5px]" value={content} onChange={(e) => setContent(e.target.value)} /></label>}
      <span className="text-[12px] leading-relaxed text-muted">{kind === 'remote' ? '更多地址、User-Agent、快照有效期在创建后的「拉取参数」里设置。创建后立即拉取一次，并打开处理链编辑器。' : '创建后打开处理链编辑器。'}</span>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** 处理链草稿变化后延迟预览（SRC-06） */
export function usePipelinePreview(kind: 'sources' | 'collections', id: string | undefined, steps: OperatorStep[] | undefined) {
  const [debounced, setDebounced] = useState(steps);
  useEffect(() => { const t = setTimeout(() => setDebounced(steps), 400); return () => clearTimeout(t); }, [steps]);
  return useQuery({
    queryKey: ['pipeline-preview', kind, id, debounced],
    enabled: !!id && id !== 'new' && !!debounced,
    queryFn: () => api<PipelinePreview>('POST', `/${kind}/${id}/pipeline-preview`, { pipeline: debounced }),
    placeholderData: (prev) => prev,
    retry: false,
  });
}

const lbl = 'text-[12.5px] font-medium text-muted';

/** 拉取参数：直接改草稿，「完成」关闭、「取消」还原打开前的值；保存仍由页面头部统一提交 */
function FetchDialog({ open, draft, set, onClose, onDelete }: {
  open: boolean; draft: SourceDoc; set: (patch: Partial<SourceDoc>) => void; onClose: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<'params' | 'snaps'>('params');
  const before = useRef<SourceDoc>(draft);
  useEffect(() => { if (open) { before.current = draft; setTab('params'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useSourceFetchState(draft.id ? draft : undefined);
  const urls = draft.urls?.length ? draft.urls : [''];
  const setFetch = (patch: Partial<NonNullable<SourceDoc['fetch']>>) => {
    const next = { ...draft.fetch, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    set({ fetch: Object.keys(next).length ? next : undefined });
  };
  const num = (v: string, scale: number) => (v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v) * scale) : undefined);
  const cancel = () => { set(before.current); onClose(); };
  return (
    <Modal title={`拉取参数 · ${draft.name}`} open={open} onClose={cancel} wide
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="danger" onClick={onDelete}>删除订阅源…</Button>
        <div className="flex gap-2"><Button onClick={cancel}>取消</Button><Button variant="primary" onClick={onClose}>完成</Button></div>
      </div>}>
      {draft.kind === 'remote' && <Segmented label="分区" value={tab} options={[{ value: 'params', label: '来源与拉取' }, { value: 'snaps', label: `快照历史 · ${state.snaps.data?.length ?? 0}` }]} onChange={setTab} />}
      {tab === 'params' || draft.kind !== 'remote' ? <>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <label className="flex flex-col gap-1.5"><span className={lbl}>名称</span><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="flex flex-col gap-1.5"><span className={lbl}>类型</span>
            <Segmented label="类型" value={draft.kind} options={[{ value: 'remote', label: '远程订阅' }, { value: 'local', label: '本地内容' }]} onChange={(kind) => set({ kind })} /></div>
        </div>
        {draft.kind === 'remote' ? <>
          <div className="flex flex-col gap-2">
            <span className={lbl}>订阅地址（多个地址按顺序合并）</span>
            {urls.map((u, i) => (
              <div key={i} className="grid grid-cols-[22px_minmax(0,1fr)_32px] items-center gap-2">
                <span className="font-mono text-[12px] text-muted">{i + 1}</span>
                <Input aria-label={`订阅地址 ${i + 1}`} className="font-mono" placeholder="https://" value={u} onChange={(e) => set({ urls: urls.map((x, j) => (j === i ? e.target.value : x)) })} />
                <Button variant="ghost" size="sm" className="w-8 px-0" aria-label={`删除地址 ${i + 1}`} disabled={urls.length === 1} onClick={() => set({ urls: urls.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button size="sm" className="w-fit" onClick={() => set({ urls: [...urls, ''] })}><Plus size={14} />添加地址</Button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <label className="flex flex-col gap-1.5"><span className={lbl}>User-Agent</span><Input className="font-mono" placeholder="clash.meta" value={draft.fetch?.ua ?? ''} onChange={(e) => setFetch({ ua: e.target.value || undefined })} /></label>
            <label className="flex flex-col gap-1.5"><span className={lbl}>快照有效期（小时）</span><Input className="font-mono" inputMode="decimal" placeholder="24" value={draft.fetch?.ttlSec === undefined ? '' : String(draft.fetch.ttlSec / 3600)} onChange={(e) => setFetch({ ttlSec: num(e.target.value, 3600) })} /></label>
            <label className="flex flex-col gap-1.5"><span className={lbl}>超时（秒）</span><Input className="font-mono" inputMode="decimal" placeholder="10" value={draft.fetch?.timeoutMs === undefined ? '' : String(draft.fetch.timeoutMs / 1000)} onChange={(e) => setFetch({ timeoutMs: num(e.target.value, 1000) })} /></label>
          </div>
          <span className="text-[12px] leading-relaxed text-muted">留空使用占位符里的默认值。快照过期后在后台刷新；刷新失败时继续使用上一份快照，订阅请求不会等待上游。</span>
        </> : (
          <label className="flex flex-col gap-1.5"><span className={lbl}>内容（URI 列表、Base64、Clash YAML 或 Surge [Proxy] 段）</span>
            <Textarea rows={8} className="font-mono text-[12.5px]" value={draft.content ?? ''} onChange={(e) => set({ content: e.target.value })} /></label>
        )}
      </> : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>时间</th><th className={th}>地址</th><th className={th}>结果</th></tr></thead>
            <tbody>
              {(state.snaps.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{formatTime(s.fetchedAt).slice(5)}</td>
                  <td className={cx(td, 'max-w-[280px] truncate font-mono text-[12px] text-muted')}>{s.url}</td>
                  <td className={td}>{s.ok ? <Badge tone="ok">成功</Badge> : <Badge tone="err">{s.error ?? '失败'}</Badge>}</td>
                </tr>
              ))}
              {!state.snaps.data?.length && <tr><td className={cx(td, 'text-muted')} colSpan={3}>还没有拉取过</td></tr>}
            </tbody>
          </table>
          <p className="mx-3 mt-2.5 mb-0 text-[12px] text-muted">订阅请求总是使用最新一份成功快照。</p>
        </div>
      )}
    </Modal>
  );
}

export function SourceEdit() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doc = useDoc('sources', id);
  const save = useSaveDoc('sources');
  const del = useDeleteDoc('sources');
  const [draft, setDraft] = useState<SourceDoc>();
  const [fetchOpen, setFetchOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (doc.data) setDraft(doc.data); }, [doc.data]);
  const preview = usePipelinePreview('sources', id === 'new' ? undefined : id, draft?.pipeline);
  const state = useSourceFetchState(doc.data);
  const refresh = useMutation({
    mutationFn: () => api<{ items: { url: string; ok: boolean; error?: string }[] }>('POST', `/sources/${id}/refresh`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['snapshots', id] });
      void qc.invalidateQueries({ queryKey: ['pipeline-preview', 'sources', id] });
      void qc.invalidateQueries({ queryKey: ['nodes', 'source', id] });
    },
  });
  // 新建后立即拉取一次（新建对话框带过来的标记，只触发一次）
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated;
  useEffect(() => {
    if (!justCreated) return;
    refresh.mutate();
    void navigate(location.pathname, { replace: true, state: null });
  }, [justCreated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id === 'new') return <Navigate to="/sources" replace state={{ create: true }} />;
  if (!draft) return doc.error ? <ErrorBox error={doc.error} /> : <div className="text-muted">加载中…</div>;
  const set = (patch: Partial<SourceDoc>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(doc.data);
  const submit = () => {
    const payload = draft.kind === 'remote'
      ? { ...draft, urls: (draft.urls ?? []).map((u) => u.trim()).filter(Boolean), content: undefined }
      : { ...draft, urls: undefined };
    save.mutate(payload);
  };
  const u = state.lastOk?.userinfo;
  const openDelete = () => { del.reset(); setFetchOpen(false); setDeleting(true); };

  return (
    <>
      <PageHeader crumbs={<><Link to="/sources" className="text-muted no-underline">订阅源</Link> / {doc.data?.name}</>}
        title={draft.name || '未命名'}
        actions={<>
          <Button onClick={() => setFetchOpen(true)}>拉取参数</Button>
          {doc.data?.kind === 'remote' && <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw size={15} />{refresh.isPending ? '拉取中…' : '立即拉取'}</Button>}
          <MoreMenu items={[{ label: '删除…', danger: true, onSelect: openDelete }]} />
          <Button variant="primary" onClick={submit} disabled={save.isPending || !dirty}>{save.isPending ? '保存中…' : dirty ? '保存处理链' : '已保存'}</Button>
        </>}>
        <Badge>{doc.data ? kindText(doc.data) : ''}</Badge>
        {state.remote && state.snaps.data && (state.lastOk
          ? <Badge tone={state.failing ? 'err' : 'ok'}>{state.failing ? '最近一次拉取失败 · 使用快照' : `${formatTime(state.lastOk.fetchedAt).slice(11)} 拉取成功`} · 快照 {state.okCount} 份</Badge>
          : <Badge tone={state.snaps.data.length ? 'err' : 'neutral'}>{state.snaps.data.length ? '拉取失败 · 没有可用快照' : '还没有拉取过'}</Badge>)}
        {u?.total ? <Badge>{formatBytes((u.upload ?? 0) + (u.download ?? 0))} / {formatBytes(u.total)}{u.expire ? ` · ${formatTime(u.expire * 1000).slice(0, 10)} 到期` : ''}</Badge> : null}
        {dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorBox error={save.error} />
      <ErrorBox error={refresh.error} />
      {refresh.data?.items.some((i) => !i.ok) && <ErrorBox error={refresh.data.items.filter((i) => !i.ok).map((i) => `${i.url}：${i.error}`).join('；')} />}

      <PipelineEditor steps={draft.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
        loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})} />

      <FetchDialog open={fetchOpen} draft={draft} set={set} onClose={() => setFetchOpen(false)} onDelete={openDelete} />
      <DeleteDialog open={deleting} title={`删除订阅源「${draft.name}」？`} error={del.error} pending={del.isPending}
        onClose={() => setDeleting(false)} onConfirm={() => del.mutate(draft.id, { onSuccess: () => navigate('/sources') })}>
        处理链和全部快照会一起删除，无法恢复。
      </DeleteDialog>
    </>
  );
}
