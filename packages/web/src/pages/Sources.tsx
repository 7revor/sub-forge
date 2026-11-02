import { ActionMenu } from '../components/ActionMenu.tsx';
import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';
import { alertError, notifySuccess } from '../feedback.ts';
import { usePipelinePreview } from '../hooks/usePipelinePreview.ts';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
// 订阅源：列表与新建对话框；详情页内编辑基础设置、处理链并实时预览，展示最近拉取状态。

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api.ts';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { Badge, Button, Card, DraftInput, ErrorAlert, Field, Input, PageHeader, PageScroll, formatBytes, formatTime, cx } from '../components/ui.tsx';
import { Notice } from '../components/Notice.tsx';
import { useDeleteDoc, useDoc, useSaveDoc, useSourceFetchState, type SourceDoc } from '../hooks.ts';

const SOURCE_DELETE_BODY = '处理链和拉取记录会一起删除，无法恢复。';

export function SourceList() {
  const location = useLocation();
  const navigate = useNavigate();
  const opened = useRef(false);
  const create = async () => {
    const result = await NewSourceModal.show({});
    if (result.status === 'confirmed') navigate(`/sources/${result.data.id}`, { state: { justCreated: true } });
  };
  useEffect(() => { if (!opened.current && (location.state as { create?: boolean } | null)?.create) { opened.current = true; void create(); } }, [location.key]);
  return (
    <>
      <DocList kind="sources" title="订阅源" noun="订阅源" onCreate={create} deleteBody={SOURCE_DELETE_BODY}
        columns={[
          { header: '名称', width: 160, cell: (s) => s.name },
          { header: '备注', width: 168, cell: (s) => <NoteCell note={s.note} /> },
          { header: '地址', width: 200, cell: (s) => <span className="block max-w-[260px] truncate font-mono text-sm text-foreground">{s.url}</span> },
          { header: '节点', width: 68, cell: (s) => <NodeSetCount nodeSet={{ type: 'source', id: s.id }} /> },
        ]} />
    </>
  );
}

const NewSourceModal = createModal<Record<string, never>, SourceDoc>(function NewSource({ modal }) {
  const save = useSaveDoc('sources', true);
  const [name, setName] = useModalDraft('');
  const [url, setUrl] = useModalDraft('');
  const ready = name.trim() && url.trim();
  const create = () => modal.submit(() => save.mutateAsync({ name: name.trim(), url: url.trim(), pipeline: [] }));
  const onClose = modal.cancel;
  return (
    <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>{"新建订阅源"}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-4">
      <Field label="名称">{(id) => <Input id={id} autoFocus placeholder="例如：机场 A" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="订阅地址" hint="多个地址请分别新建，再用节点组合合并">{(id) => <Input id={id} type="url" className="font-mono" placeholder="上游节点订阅的 HTTP 或 HTTPS 地址" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
    </div><ModalFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!ready || modal.pending} onClick={create}>{save.isPending ? '创建中…' : '创建并拉取'}</Button></>}</ModalFooter></ModalContent>
  );
});

/** 基础设置和处理链共用页面草稿。 */
function BasicSettings({ draft, set }: {
  draft: SourceDoc; set: (patch: Partial<SourceDoc>) => void;
}) {
  return (
    <Card bodyClass="flex flex-col gap-4 px-5 pt-4 pb-5">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="名称" className="min-w-0">{(id) => <Input id={id} placeholder="例如：机场 A" value={draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="订阅地址" className="min-w-0">{(id) =>
          <Input id={id} type="url" className="font-mono" placeholder="上游节点订阅的 HTTP 或 HTTPS 地址" value={draft.url} onChange={(e) => set({ url: e.target.value })} />
        }</Field>
      <NoteField compact value={draft.note} onChange={(note) => set({ note })} />
      </div>
      <p className="m-0 text-xs text-muted-foreground">到期自动重新拉取（管理员在「系统」中统一设置）；失败时继续使用上次成功的内容。</p>
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
  const previous=useRef<SourceDoc|undefined>(undefined);
  useEffect(()=>{if(doc.data){const before=previous.current;previous.current=doc.data;setDraft(current=>!current||current.id!==doc.data!.id||JSON.stringify(current)===JSON.stringify(before)?doc.data:current);}},[doc.data]);
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
  if (!draft) return doc.error ? <ErrorAlert error={doc.error} /> : <div className="text-muted-foreground">加载中…</div>;
  const set = (patch: Partial<SourceDoc>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(doc.data);
  const submit = () => {
    save.mutate({ ...draft, name: draft.name.trim(), url: draft.url.trim() },{onSuccess:item=>setDraft(item)});
  };
  const u = state.lastOk?.userinfo;
  const openDelete = async () => { del.reset(); const result = await Frame.modal.confirm({ title: `删除订阅源「${draft.name}」？`, description: SOURCE_DELETE_BODY, confirmLabel: '删除', danger: true }, { submit: async () => { await del.mutateAsync(draft.id); } }); if (result.status === 'confirmed') navigate('/sources'); };
  const busy = save.isPending || refresh.isPending;
  const ready = !!draft.name.trim() && !!draft.url.trim();
  const saveAndRefresh = () => {
    if (dirty) save.mutate({ ...draft, name: draft.name.trim(), url: source!.url }, { onSuccess: () => refresh.mutate() });
    else refresh.mutate();
  };

  return (
    <>
      <PageHeader crumbs={<><Link to="/sources" className="text-muted-foreground no-underline">订阅源</Link> / {doc.data?.name}</>}
        title={draft.name || '未命名'}
        actions={<>
          <ResourceLinkButton kind="sources" id={draft.id} name={draft.name} disabled={dirty} />
          <Button onClick={saveAndRefresh} disabled={busy || !ready}><RefreshCw size={15} />{refresh.isPending ? '拉取中…' : dirty ? '保存并拉取' : '立即拉取'}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !dirty || !ready}>{save.isPending ? '保存中…' : dirty ? '保存修改' : '已保存'}</Button>
          <ActionMenu size="md" items={[{ label: '删除订阅源', danger: true, onSelect: openDelete }]} />
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

      <PageScroll className="source-detail-content">
        {preview.data?.report.filter((r) => r.level === 'error' || (r.level === 'warn' && r.code !== 'source.fetch-failed')).map((r, i) => (
          <Notice key={i} tone={r.level === 'error' ? 'err' : 'warn'} actions={r.level === 'error' && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy || !ready} onClick={saveAndRefresh}>重试</Button>}>{r.message}</Notice>
        ))}
        <BasicSettings draft={draft} set={set} />
        <PipelineEditor steps={draft.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})} />

      </PageScroll>

    </>
  );
}
