// 订阅源：列表、详情（拉取参数、快照历史）与处理链编辑器。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperatorStep } from '@sub-forge/core';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type PipelinePreview, type SnapshotMeta } from '../api.ts';
import { DocList, deleteErrorText } from '../components/DocList.tsx';
import { PipelineEditor } from '../components/PipelineEditor.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Segmented, Textarea, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useDeleteDoc, useDoc, useSaveDoc, type SourceDoc } from '../hooks.ts';

export function SourceList() {
  return (
    <DocList kind="sources" title="订阅源" intro="节点来源：远程订阅地址或粘贴的本地内容。改名、过滤、排序都写在处理链里，上游更新后结果始终确定。"
      columns={[
        { header: '名称', cell: (s) => s.name },
        { header: '类型', cell: (s) => <Badge>{s.kind === 'remote' ? `远程 · ${s.urls?.length ?? 0} 个地址` : '本地'}</Badge> },
        { header: '处理链', cell: (s) => <span className="font-mono">{s.pipeline.length} 步</span> },
      ]} />
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

const EMPTY: SourceDoc = { id: '', name: '', kind: 'remote', urls: [], pipeline: [] };

export function SourceEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const doc = useDoc('sources', id);
  const save = useSaveDoc('sources');
  const del = useDeleteDoc('sources');
  const [draft, setDraft] = useState<SourceDoc | undefined>(isNew ? EMPTY : undefined);
  useEffect(() => { if (doc.data) setDraft(doc.data); }, [doc.data]);
  const preview = usePipelinePreview('sources', isNew ? undefined : id, draft?.pipeline);
  const snaps = useQuery({ queryKey: ['snapshots', id], enabled: !isNew && draft?.kind === 'remote', queryFn: () => api<{ items: SnapshotMeta[] }>('GET', `/sources/${id}/snapshots`).then((r) => r.items) });
  const refresh = useMutation({
    mutationFn: () => api<{ items: { url: string; ok: boolean; error?: string }[] }>('POST', `/sources/${id}/refresh`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['snapshots', id] }); void qc.invalidateQueries({ queryKey: ['pipeline-preview', 'sources', id] }); },
  });

  if (!draft) return doc.error ? <ErrorBox error={doc.error} /> : <div className="text-muted">加载中…</div>;
  const set = (patch: Partial<SourceDoc>) => setDraft({ ...draft, ...patch });
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(doc.data);

  const submit = () => {
    const { id: _id, ...body } = draft;
    const payload = draft.kind === 'remote' ? { ...body, urls: (draft.urls ?? []).map((u) => u.trim()).filter(Boolean), content: undefined } : { ...body, urls: undefined };
    save.mutate(isNew ? payload : { ...payload, id: draft.id }, { onSuccess: (item) => { if (isNew) navigate(`/sources/${item.id}`, { replace: true }); } });
  };
  const lastOk = snaps.data?.find((s) => s.ok);
  const u = lastOk?.userinfo;

  return (
    <>
      <PageHeader crumbs={<><Link to="/sources" className="text-muted no-underline">订阅源</Link> / {isNew ? '新建' : draft.name}</>}
        title={isNew ? '新建订阅源' : draft.name || '未命名'}
        actions={<>
          {!isNew && draft.kind === 'remote' && <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw size={15} />{refresh.isPending ? '拉取中…' : '立即拉取'}</Button>}
          <Button variant="primary" onClick={submit} disabled={save.isPending || !dirty}>{save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
        </>}>
        {!isNew && <Badge>{doc.data?.kind === 'remote' ? `远程 · ${doc.data.urls?.length ?? 0} 个地址` : '本地内容'}</Badge>}
        {!isNew && draft.kind === 'remote' && snaps.data && (lastOk
          ? <Badge tone={snaps.data[0]?.ok ? 'ok' : 'err'}>{snaps.data[0]?.ok ? `${formatTime(lastOk.fetchedAt).slice(11)} 拉取成功` : '最近一次拉取失败 · 使用快照'} · 快照 {snaps.data.filter((x) => x.ok).length} 份</Badge>
          : <Badge tone={snaps.data.length ? 'err' : 'neutral'}>{snaps.data.length ? '拉取失败 · 没有可用快照' : '还没有拉取过'}</Badge>)}
        {!isNew && u?.total ? <Badge>{formatBytes((u.upload ?? 0) + (u.download ?? 0))} / {formatBytes(u.total)}{u.expire ? ` · ${formatTime(u.expire * 1000).slice(0, 10)} 到期` : ''}</Badge> : null}
      </PageHeader>
      <ErrorBox error={save.error} />
      {refresh.data?.items.some((i) => !i.ok) && <ErrorBox error={refresh.data.items.filter((i) => !i.ok).map((i) => `${i.url}：${i.error}`).join('；')} />}

      <Card title="来源">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
            <Field label="名称">{(fid) => <Input id={fid} value={draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
            <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">类型</span>
              <Segmented label="类型" value={draft.kind} options={[{ value: 'remote', label: '远程订阅' }, { value: 'local', label: '本地内容' }]} onChange={(kind) => set({ kind })} /></div>
          </div>
          {draft.kind === 'remote' ? (
            <>
              <Field label="订阅地址（每行一个，多个地址按顺序合并）">{(fid) => <Textarea id={fid} rows={3} className="font-mono" value={(draft.urls ?? []).join('\n')} onChange={(e) => set({ urls: e.target.value.split('\n') })} />}</Field>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <Field label="User-Agent">{(fid) => <Input id={fid} placeholder="默认 clash.meta" value={draft.fetch?.ua ?? ''} onChange={(e) => set({ fetch: { ...draft.fetch, ua: e.target.value || undefined } })} />}</Field>
                <Field label="快照有效期（秒）" hint="过期后后台刷新；刷新失败时继续使用上一份快照">{(fid) => <Input id={fid} type="number" min={300} placeholder="默认 86400（24 小时）" value={draft.fetch?.ttlSec ?? ''} onChange={(e) => set({ fetch: { ...draft.fetch, ttlSec: e.target.value ? Number(e.target.value) : undefined } })} />}</Field>
                <Field label="超时（毫秒）">{(fid) => <Input id={fid} type="number" min={1000} placeholder="默认 10000" value={draft.fetch?.timeoutMs ?? ''} onChange={(e) => set({ fetch: { ...draft.fetch, timeoutMs: e.target.value ? Number(e.target.value) : undefined } })} />}</Field>
              </div>
            </>
          ) : (
            <Field label="内容" hint="URI 列表、Base64、Clash YAML 或 Surge [Proxy] 段">{(fid) => <Textarea id={fid} rows={6} className="font-mono" value={draft.content ?? ''} onChange={(e) => set({ content: e.target.value })} />}</Field>
          )}
        </div>
      </Card>

      {isNew ? <Card title="处理链"><p className="m-0 text-[13px] text-muted">保存后即可编辑处理链并逐步预览。</p></Card> : (
        <PipelineEditor steps={draft.pipeline} onChange={(pipeline) => set({ pipeline })} {...(preview.data ? { preview: preview.data } : {})}
          loading={preview.isFetching} {...(preview.error ? { previewError: (preview.error as Error).message } : {})} />
      )}

      {!isNew && draft.kind === 'remote' && (
        <Card title="快照历史" bodyClass="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>时间</th><th className={th}>地址</th><th className={th}>结果</th></tr></thead>
            <tbody>
              {(snaps.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td className={cx(td, 'font-mono text-[12.5px]')}>{formatTime(s.fetchedAt)}</td>
                  <td className={cx(td, 'max-w-[420px] truncate font-mono text-[12px] text-muted')}>{s.url}</td>
                  <td className={td}>{s.ok ? <Badge tone="ok">成功</Badge> : <Badge tone="err">{s.error}</Badge>}</td>
                </tr>
              ))}
              {!snaps.data?.length && <tr><td className={cx(td, 'text-muted')} colSpan={3}>还没有拉取过</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {!isNew && (
        <div className="flex flex-col items-start gap-2">
          <Button variant="danger" onClick={() => { if (confirm(`删除订阅源「${draft.name}」？`)) del.mutate(draft.id, { onSuccess: () => navigate('/sources') }); }}>删除订阅源</Button>
          {del.error && <ErrorBox error={deleteErrorText(del.error)} />}
        </div>
      )}
    </>
  );
}
