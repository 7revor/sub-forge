import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog.tsx';
import { alertError, notifySuccess } from '../feedback.ts';
import { usePipelinePreview } from '../hooks/usePipelinePreview.ts';
import { SourceFetchStatus } from '../components/SourceFetchStatus.tsx';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
// 订阅源：列表与新建对话框；详情页内编辑基础设置、处理链并实时预览，展示最近拉取状态。

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api.ts';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { DeleteDialog } from '../components/DetailActions.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { Badge, Button, Card, DraftInput, ErrorAlert, Field, Input, PageHeader, PageScroll, formatBytes, formatTime, cx } from '../components/ui.tsx';
import { useDeleteDoc, useDoc, useSaveDoc, useSourceFetchState, type SourceDoc } from '../hooks.ts';

function SourceState({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  return <SourceFetchStatus state={s} />;
}

function SourceLast({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  return <span className="text-ink-2">{s.lastOk ? formatTime(s.lastOk.fetchedAt).slice(5) : '—'}</span>;
}

const SOURCE_DELETE_BODY = '处理链和拉取记录会一起删除，无法恢复。';

export function SourceList() {
  const location = useLocation();
  const [creating, setCreating] = useState(!!(location.state as { create?: boolean } | null)?.create);
  return (
    <>
      <DocList kind="sources" title="订阅源" noun="订阅源" onCreate={() => setCreating(true)} deleteBody={SOURCE_DELETE_BODY}
        columns={[
          { header: '名称', cell: (s) => s.name },
          { header: '备注', cell: (s) => s.note?.trim() ? <NoteCell note={s.note} /> : null },
          { header: '地址', cell: (s) => <span className="block max-w-[260px] truncate font-mono text-[12px] text-ink-2">{s.url}</span> },
          { header: '节点', cell: (s) => <NodeSetCount nodeSet={{ type: 'source', id: s.id }} /> },
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
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const ready = name.trim() && url.trim();
  const create = () => save.mutate(
    { name: name.trim(), url: url.trim(), note, pipeline: [] },
    { onSuccess: (item) => navigate(`/sources/${item.id}`, { state: { justCreated: true } }) },
  );
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) (onClose)(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><DialogHeader><DialogTitle>{"新建订阅源"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      <Field label="名称">{(id) => <Input id={id} autoFocus placeholder="例如：机场 A" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="订阅地址">{(id) => <Input id={id} type="url" className="font-mono" placeholder="上游节点订阅的 HTTP 或 HTTPS 地址" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
      <NoteField value={note} onChange={setNote} />
      <ErrorAlert error={save.error} />
    </div><DialogFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!ready || save.isPending} onClick={create}>{save.isPending ? '创建中…' : '创建并编辑'}</Button></>}</DialogFooter></DialogContent></Dialog>
  );
}

/** 基础设置和处理链共用页面草稿。 */
function BasicSettings({ draft, set }: {
  draft: SourceDoc; set: (patch: Partial<SourceDoc>) => void;
}) {
  return (
    <Card title="基础设置" bodyClass="flex flex-col gap-3.5 border-t border-line-2 px-4 pt-3 pb-3.5">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
        <Field label="名称" className="min-w-0 sm:col-span-2">{(id) => <Input id={id} placeholder="例如：机场 A" value={draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="自动更新时间（小时）" className="min-w-0">{(id) => <DraftInput id={id} type="number" min={5 / 60} step="any" className="font-mono" inputMode="decimal" placeholder="上游订阅的更新间隔，留空为 24 小时" value={draft.fetch?.ttlSec === undefined ? '' : String(draft.fetch.ttlSec / 3600)} onCommit={(value) => {
          const ttlSec = value.trim() && Number.isFinite(Number(value)) ? Math.round(Number(value) * 3600) : undefined;
          set({ fetch: ttlSec === undefined ? undefined : { ttlSec } });
        }} />}</Field>
        <Field label="订阅地址" className="col-span-full min-w-0">{(id) =>
          <Input id={id} type="url" className="font-mono" placeholder="上游节点订阅的 HTTP 或 HTTPS 地址" value={draft.url} onChange={(e) => set({ url: e.target.value })} />
        }</Field>
      </div>
      <NoteField value={draft.note} onChange={(note) => set({ note })} />
      <p className="m-0 text-[12px] leading-relaxed text-ink-muted">默认 24 小时，最短 5 分钟。超过间隔后，下次读取时后台更新；失败时继续使用上次成功内容。</p>
    </Card>
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
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (doc.data) setDraft(doc.data); }, [doc.data]);
  const source = useMemo(() => draft ? { url: draft.url.trim(), fetch: draft.fetch ?? {} } : undefined, [draft?.url, draft?.fetch]);
  const preview = usePipelinePreview('sources', id === 'new' ? undefined : id, draft?.pipeline, undefined, source);
  const state = useSourceFetchState(doc.data);
  const refresh = useMutation({
    mutationFn: () => api<{ items: { url: string; ok: boolean; error?: string }[] }>('POST', `/sources/${id}/refresh`),
    onSuccess: (result) => {
      const failures = result.items.filter(item => !item.ok);
      if (failures.length) alertError(failures.map(item => `${item.url}：${item.error ?? '拉取失败'}`).join('；'));
      else notifySuccess('订阅源已拉取');
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
  if (!draft) return doc.error ? <ErrorAlert error={doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const set = (patch: Partial<SourceDoc>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(doc.data);
  const submit = () => {
    save.mutate({ ...draft, name: draft.name.trim(), url: draft.url.trim() });
  };
  const u = state.lastOk?.userinfo;
  const openDelete = () => { del.reset(); setDeleting(true); };
  const busy = save.isPending || refresh.isPending;
  const ready = !!draft.name.trim() && !!draft.url.trim();
  const saveAndRefresh = () => {
    if (dirty) save.mutate({ ...draft, name: draft.name.trim(), url: source!.url }, { onSuccess: () => refresh.mutate() });
    else refresh.mutate();
  };

  return (
    <>
      <PageHeader crumbs={<><Link to="/sources" className="text-ink-muted no-underline">订阅源</Link> / {doc.data?.name}</>}
        title={draft.name || '未命名'}
        actions={<>
          <Button onClick={saveAndRefresh} disabled={busy || !ready}><RefreshCw size={15} />{refresh.isPending ? '拉取中…' : dirty ? '保存并拉取' : '立即拉取'}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !dirty || !ready}>{save.isPending ? '保存中…' : dirty ? '保存修改' : '已保存'}</Button>
          <Button variant="danger" onClick={openDelete}>删除</Button>
        </>}>
        {state.snaps.data && (state.lastOk
          ? <Badge tone={state.failing ? 'err' : 'ok'}>{state.failing ? '最近一次拉取失败 · 使用上次成功内容' : `${formatTime(state.lastOk.fetchedAt).slice(11)} 拉取成功`}</Badge>
          : <Badge tone={state.failing ? 'err' : 'neutral'}>{state.failing ? '拉取失败 · 没有可用内容' : '还没有拉取过'}</Badge>)}
        {u?.total ? <Badge>{formatBytes((u.upload ?? 0) + (u.download ?? 0))} / {formatBytes(u.total)}{u.expire ? ` · ${formatTime(u.expire * 1000).slice(0, 10)} 到期` : ''}</Badge> : null}
        {dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorAlert error={save.error} />
      <ErrorAlert error={refresh.error} />
      <ErrorAlert error={state.snaps.error} />

      <PageScroll>
        {preview.data?.report.filter((r) => r.level === 'error' || r.level === 'warn').map((r, i) => (
          <div key={i} role="status" className={cx('rounded-lg px-3 py-2 text-[13px]', r.level === 'error' ? 'bg-err-soft text-err' : 'bg-warn-soft text-warn')}>{r.message}</div>
        ))}
        <BasicSettings draft={draft} set={set} />
        <PipelineEditor steps={draft.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})} />

      </PageScroll>
      <DeleteDialog open={deleting} title={`删除订阅源「${draft.name}」？`} error={del.error} pending={del.isPending}
        onClose={() => setDeleting(false)} onConfirm={() => del.mutate(draft.id, { onSuccess: () => navigate('/sources') })}>
        {SOURCE_DELETE_BODY}
      </DeleteDialog>
    </>
  );
}
