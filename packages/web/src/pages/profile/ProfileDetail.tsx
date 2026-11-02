import { useProfileCopy } from './useProfileCopy.ts';
import { RefreshCacheButton } from '../../components/ResourceCache.tsx';
import { useLeaveGuard } from '../../hooks/useLeaveGuard.ts';
import { ActionMenu } from '../../components/ActionMenu.tsx';
import { ResourceLinkButton } from '../../components/ResourceLinkButton.tsx';
import { Frame } from '../../modals/Frame.tsx';
import { ProfileInfoModal } from './ProfileInfoModal.tsx';
import { queryUrl } from '@sub-forge/core';
import { acceptProfileSave, modeLabel, syncProfileDraft } from './routing.ts';
// 与新建共用两个标签页；旧分区链接仍进入相应设置。

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DeleteAction } from '../../components/DetailActions.tsx';
import { Badge, Button, ErrorAlert, PageHeader } from '../../components/ui.tsx';
import { useDeleteDoc, useDoc, useList, useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { ProfileSections } from './ProfileSections.tsx';

export function ProfileDetail() {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const doc = useDoc('profiles', id);
  const save = useSaveDoc('profiles');
  const copyProfile = useProfileCopy();
  const del = useDeleteDoc('profiles');
  const [draft, setDraft] = useState<ProfileDoc>();
  const previous = useRef<ProfileDoc | undefined>(undefined);
  useEffect(() => {
    if (!doc.data) return;
    const before = previous.current;
    const incoming = doc.data;
    previous.current = incoming;
    setDraft(current => syncProfileDraft(current, before, incoming));
  }, [doc.data]);

  const { ctx, template } = useProfileCtx(draft, setDraft);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(doc.data);
  const { leave } = useLeaveGuard(dirty, ({ nextLocation }) => !nextLocation.pathname.startsWith(`/profiles/${id}/`) && nextLocation.pathname !== `/profiles/${id}`, () => ({ what: draft?.name ?? '配置订阅', canSave: !!draft?.name.trim(), onSave: async () => { if (draft) { const saved = await save.mutateAsync({ ...draft, name: draft.name.trim() }); setDraft(saved); } } }));
  if (!draft || !ctx) return doc.error ? <ErrorAlert error={doc.error} /> : <div className="text-muted-foreground">加载中…</div>;
  const validName = !!draft.name.trim();
  const discard = () => { setDraft(doc.data);  };

  return (
    <ProfileContext.Provider value={ctx}>
      <PageHeader crumbs={<><Link to="/profiles" className="text-muted-foreground no-underline">配置订阅</Link> / {draft.name}</>} title={draft.name} subtitle={draft.note ? `备注：${draft.note}` : undefined}
        actions={<>
          <ResourceLinkButton kind="profiles" id={draft.id} name={draft.name} disabled={dirty} />
          {dirty && <Button variant="ghost" onClick={discard}>放弃修改</Button>}
          <Button variant="primary" disabled={!validName || !dirty || save.isPending} onClick={() => { if (validName) save.mutate({ ...draft, name: draft.name.trim() }, { onSuccess: saved => setDraft(current => acceptProfileSave(current, draft, saved)) }); }}>{save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
          <ActionMenu size="md" items={[
            { label: '编辑名称与备注', onSelect: async () => { const result = await ProfileInfoModal.show({ name: draft.name, note: draft.note }); if (result.status === 'confirmed') setDraft({ ...draft, ...result.data }); } },
            { label: '复制为新订阅', onSelect: () => void copyProfile(draft) },
            { label: '删除配置订阅…', danger: true, onSelect: async () => { const result = await Frame.modal.confirm({ title: `删除配置订阅「${draft.name}」？`, description: '它的订阅链接会立即失效，客户端将无法更新。', confirmLabel: '删除', danger: true }, { submit: async () => { await del.mutateAsync(draft.id); } }); if (result.status === 'confirmed') leave('/profiles'); } },
          ]}><RefreshCacheButton kind="profiles" id={draft.id} name={draft.name} disabled={dirty} /></ActionMenu>
        </>}>
        <Badge tone="accent">
          {modeLabel(draft, template.data?.name)}
        </Badge>
        {dirty && <Badge tone="warn">未保存</Badge>}
      </PageHeader>
      <ErrorAlert error={save.error} />
      {draft.migration && <div className="rounded-lg bg-muted px-4 py-3 text-sm">迁移记录：{draft.migration.reason}。迁移前配置已备份。<a className="ml-2 text-primary" href={queryUrl('/api/profiles/migration-backup', { id: draft.id })} download={`${draft.id}-迁移前配置.json`}>下载迁移前配置</a>{draft.migration.issues.length > 0 && ` 有 ${draft.migration.issues.length} 项历史诊断，请检查预览。`}</div>}
      {template.error && <ErrorAlert error={template.error} />}

      <ProfileSections initialSection={tab} routingReady={draft.routing?.mode !== 'bound' || !!template.data} />
    </ProfileContext.Provider>
  );
}
