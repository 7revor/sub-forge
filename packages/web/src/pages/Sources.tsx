// 订阅源：列表与新建对话框；详情页内编辑基础设置、处理链并实时预览，展开查看快照历史。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Collection, OperatorStep } from '@sub-forge/core';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { api, type PipelinePreview } from '../api.ts';
import { DocList } from '../components/DocList.tsx';
import { DeleteDialog } from '../components/DetailActions.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { Badge, Button, Card, DraftInput, Empty, ErrorBox, Field, Input, Modal, PageHeader, PageScroll, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useDeleteDoc, useDoc, useNodeList, useSaveDoc, useSourceFetchState, type SourceDoc } from '../hooks.ts';

function SourceNodes({ source }: { source: SourceDoc }) {
  const nodes = useNodeList({ type: 'source', id: source.id });
  return <span className="font-mono text-[13px]">{nodes.data ? nodes.data.total : '—'}</span>;
}

function SourceState({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  if (s.failing) return <Badge tone="err">{s.lastOk ? '拉取失败 · 使用快照' : '拉取失败'}</Badge>;
  return s.lastOk ? <Badge tone="ok">正常</Badge> : <Badge>未拉取</Badge>;
}

function SourceLast({ source }: { source: SourceDoc }) {
  const s = useSourceFetchState(source);
  return <span className="text-ink-2">{s.lastOk ? formatTime(s.lastOk.fetchedAt).slice(5) : '—'}</span>;
}

const SOURCE_DELETE_BODY = '处理链和全部快照会一起删除，无法恢复。';

export function SourceList() {
  const location = useLocation();
  const [creating, setCreating] = useState(!!(location.state as { create?: boolean } | null)?.create);
  return (
    <>
      <DocList kind="sources" title="订阅源" noun="订阅源" onCreate={() => setCreating(true)} deleteBody={SOURCE_DELETE_BODY}
        intro="节点来源：机场的订阅地址。改名、过滤、排序都写在处理链里；自己整理的节点放在「本地节点」。"
        empty="添加机场的订阅地址，之后在处理链里改名、过滤、排序。自己整理的节点请放到「本地节点」。"
        columns={[
          { header: '名称', cell: (s) => s.name },
          { header: '地址', cell: (s) => <span className="block max-w-[260px] truncate font-mono text-[12px] text-ink-2">{s.url}</span> },
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
  const [url, setUrl] = useState('');
  const ready = name.trim() && url.trim();
  const create = () => save.mutate(
    { name: name.trim(), url: url.trim(), pipeline: [] },
    { onSuccess: (item) => navigate(`/sources/${item.id}`, { state: { justCreated: true } }) },
  );
  return (
    <Modal title="新建订阅源" open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!ready || save.isPending} onClick={create}>{save.isPending ? '创建中…' : '创建并编辑'}</Button></>}>
      <Field label="名称">{(id) => <Input id={id} autoFocus placeholder="例如：机场 A" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="订阅地址">{(id) => <Input id={id} type="url" className="font-mono" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
      <span className="text-[12px] leading-relaxed text-muted">每个订阅源只使用一个 URL；多个来源请通过「组合」合并。User-Agent、快照有效期在详情页的「基础设置」里设置。创建后立即拉取一次，并打开编辑与预览。自己整理的节点请到 <Link to="/locals" onClick={onClose}>本地节点</Link>，在新增节点的原始配置中粘贴。</span>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/**
 * 处理链草稿变化后延迟预览（SRC-06）。组合同时带上成员草稿（COL-02）：
 * 订阅源同时带上基础设置草稿，切换参数后隐藏旧预览，避免把旧地址的节点当作新结果。
 */
export function usePipelinePreview(kind: 'sources' | 'collections', id: string | undefined, steps: OperatorStep[] | undefined, members?: Collection['members'], source?: Pick<SourceDoc, 'url' | 'fetch'>) {
  const draft = useMemo(() => (steps ? { pipeline: steps, ...(members ? { members } : {}), ...(source ? { source } : {}) } : undefined), [steps, members, source]);
  const [debounced, setDebounced] = useState(draft);
  useEffect(() => { const t = setTimeout(() => setDebounced(draft), 400); return () => clearTimeout(t); }, [draft]);
  const query = useQuery({
    queryKey: ['pipeline-preview', kind, id, debounced],
    enabled: !!id && id !== 'new' && !!debounced,
    queryFn: () => api<PipelinePreview>('POST', `/${kind}/${id}/pipeline-preview`, debounced),
    placeholderData: (prev, previous) => JSON.stringify((previous?.queryKey[3] as typeof draft)?.source) === JSON.stringify(source) ? prev : undefined,
    retry: false,
  });
  return { ...query, data: JSON.stringify(source) === JSON.stringify(debounced?.source) ? query.data : undefined, isFetching: query.isFetching || draft !== debounced };
}

/** 基础设置与快照历史在详情页直接编辑，和处理链共用页面草稿。 */
function BasicSettings({ draft, set, state }: {
  draft: SourceDoc; set: (patch: Partial<SourceDoc>) => void; state: ReturnType<typeof useSourceFetchState>;
}) {
  const setFetch = (patch: Partial<NonNullable<SourceDoc['fetch']>>) => {
    const next = { ...draft.fetch, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    set({ fetch: Object.keys(next).length ? next : undefined });
  };
  const num = (v: string, scale: number) => (v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v) * scale) : undefined);
  return (
    <Card title="基础设置" actions={<span className="text-[12px] text-muted">修改后自动预览 · 保存后生效</span>} bodyClass="flex flex-col gap-3.5 border-t border-line-2 px-4 pt-3 pb-3.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-start gap-3">
        <Field label="订阅地址" className="col-span-full min-w-0" hint="每个订阅源使用一个 URL，多个来源请通过「组合」合并。">{(id) =>
          <Input id={id} type="url" className="font-mono" placeholder="https://" value={draft.url} onChange={(e) => set({ url: e.target.value })} />
        }</Field>
        <Field label="名称" className="min-w-0">{(id) => <Input id={id} placeholder="例如：机场 A" value={draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="User-Agent" className="min-w-0">{(id) => <Input id={id} className="font-mono" placeholder="clash.meta" value={draft.fetch?.ua ?? ''} onChange={(e) => setFetch({ ua: e.target.value || undefined })} />}</Field>
        <Field label="快照有效期（小时）" className="min-w-0">{(id) => <DraftInput id={id} type="number" min={5 / 60} step="any" className="font-mono" inputMode="decimal" placeholder="24" value={draft.fetch?.ttlSec === undefined ? '' : String(draft.fetch.ttlSec / 3600)} onCommit={(value) => setFetch({ ttlSec: num(value, 3600) })} />}</Field>
        <Field label="超时（秒）" className="min-w-0">{(id) => <DraftInput id={id} type="number" min="0.001" step="any" className="font-mono" inputMode="decimal" placeholder="10" value={draft.fetch?.timeoutMs === undefined ? '' : String(draft.fetch.timeoutMs / 1000)} onCommit={(value) => setFetch({ timeoutMs: num(value, 1000) })} />}</Field>
      </div>
      <p className="m-0 text-[12px] leading-relaxed text-muted">拉取选项留空使用默认值，快照有效期最短 5 分钟。快照过期后在后台刷新，失败时继续使用上一份成功快照。</p>
      <details className="min-w-0 border-t border-line pt-3">
        <summary className="cursor-pointer text-[13px] font-medium">快照历史 · {state.snaps.data?.length ?? 0}</summary>
        <ErrorBox error={state.snaps.error} />
        <div className="mt-2 overflow-x-auto">
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
              {!state.snaps.data?.length && !state.snaps.error && <tr><td className={td} colSpan={3}>{state.snaps.isLoading ? <span className="text-muted">加载中…</span> : <Empty title="还没有拉取过" />}</td></tr>}
            </tbody>
          </table>
          <p className="mx-3 mt-2.5 mb-0 text-[12px] text-muted">订阅请求总是使用最新一份成功快照。</p>
        </div>
      </details>
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
      <PageHeader crumbs={<><Link to="/sources" className="text-muted no-underline">订阅源</Link> / {doc.data?.name}</>}
        title={draft.name || '未命名'}
        actions={<>
          <Button onClick={saveAndRefresh} disabled={busy || !ready}><RefreshCw size={15} />{refresh.isPending ? '拉取中…' : dirty ? '保存并拉取' : '立即拉取'}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !dirty || !ready}>{save.isPending ? '保存中…' : dirty ? '保存修改' : '已保存'}</Button>
          <Button variant="danger" onClick={openDelete}>删除</Button>
        </>}>
        {state.snaps.data && (state.lastOk
          ? <Badge tone={state.failing ? 'err' : 'ok'}>{state.failing ? '最近一次拉取失败 · 使用快照' : `${formatTime(state.lastOk.fetchedAt).slice(11)} 拉取成功`} · 快照 {state.okCount} 份</Badge>
          : <Badge tone={state.snaps.data.length ? 'err' : 'neutral'}>{state.snaps.data.length ? '拉取失败 · 没有可用快照' : '还没有拉取过'}</Badge>)}
        {u?.total ? <Badge>{formatBytes((u.upload ?? 0) + (u.download ?? 0))} / {formatBytes(u.total)}{u.expire ? ` · ${formatTime(u.expire * 1000).slice(0, 10)} 到期` : ''}</Badge> : null}
        {dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorBox error={save.error} />
      <ErrorBox error={refresh.error} />
      {refresh.data?.items.some((i) => !i.ok) && <ErrorBox error={refresh.data.items.filter((i) => !i.ok).map((i) => `${i.url}：${i.error}`).join('；')} />}

      <PageScroll>
        {preview.data?.report.filter((r) => r.level === 'error' || r.level === 'warn').map((r, i) => (
          <div key={i} role="status" className={cx('rounded-lg px-3 py-2 text-[13px]', r.level === 'error' ? 'bg-err-soft text-err' : 'bg-warn-soft text-warn')}>{r.message}</div>
        ))}
        <BasicSettings draft={draft} set={set} state={state} />
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
