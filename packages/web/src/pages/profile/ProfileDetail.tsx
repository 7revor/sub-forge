import { acceptProfileSave, modeLabel, syncProfileDraft } from './routing.ts';
import { accessLogOptions, tokenOptions } from '../../hooks/documentQueries.ts';
import { CopyButton } from '../../components/CopyButton.tsx';
// 与新建共用单页编辑，旧分区链接保留为页内定位入口。

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DeleteAction } from '../../components/DetailActions.tsx';
import { Badge, Button, ErrorAlert, PageHeader, PageScroll } from '../../components/ui.tsx';
import { TemplateCard } from './TemplateCard.tsx';
import { useDeleteDoc, useDoc, useList, useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { TabOverview } from './TabsBasic.tsx';
import { ProfileSections } from './ProfileSections.tsx';
import { ProfileEditGuard } from './ProfileEditGuard.tsx';

export function ProfileDetail() {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const doc = useDoc('profiles', id);
  const save = useSaveDoc('profiles');
  const dup = useSaveDoc('profiles');
  const del = useDeleteDoc('profiles');
  const presets = useList('presets');
  const tokens = useQuery(tokenOptions(id));
  const log = useQuery(accessLogOptions(id));
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

  if (!draft || !ctx) return doc.error ? <ErrorAlert error={doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const dirty = !ctx.baseValid || JSON.stringify(draft) !== JSON.stringify(doc.data);
  const discard = () => { setDraft(doc.data); ctx.resetBaseEditor(); };
  const preset = presets.data?.find((p) => p.id === draft.base?.presetId);
  const warnings = log.data?.[0]?.warnings ?? 0;
  const firstUrl = tokens.data?.[0]?.url;
  const duplicate = () => {
    const { id: _id, ...rest } = doc.data ?? draft;
    dup.mutate({ ...rest, name: `${rest.name} 副本` }, { onSuccess: (p) => navigate(`/profiles/${p.id}/overview`) });
  };

  return (
    <ProfileContext.Provider value={ctx}>
      <div className="flex flex-col gap-2.5">
        <PageHeader crumbs={<><Link to="/profiles" className="text-ink-muted no-underline">配置订阅</Link> / {draft.name}</>} title={draft.name}
          actions={<>
            {dirty && <Button onClick={discard}>放弃修改</Button>}
            <Button onClick={duplicate} disabled={dup.isPending}>{dup.isPending ? '复制中…' : '复制配置订阅'}</Button>
            {!dirty && <CopyButton text={firstUrl ?? ''} disabled={!firstUrl} title={firstUrl ? undefined : '先在页面下方新增订阅链接'}>复制订阅链接</CopyButton>}
            <Button variant="primary" disabled={!ctx.baseValid || !dirty || save.isPending} onClick={() => { if (ctx.baseValid) save.mutate(draft, { onSuccess: saved => setDraft(current => acceptProfileSave(current, draft, saved)) }); }}>{save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
            <DeleteAction what="配置订阅" name={draft.name} body="它的所有订阅链接会立即失效，客户端将无法更新。" error={del.error} pending={del.isPending}
              onReset={del.reset} onDelete={() => del.mutate(draft.id, { onSuccess: () => navigate('/profiles') })} />
          </>}>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12.5px] text-accent-ink">
            {modeLabel(draft, template.data?.name)}{template.data && ' · 自动更新'}
          </span>
          {preset && <Badge>基础设置 {preset.name}</Badge>}
          {warnings > 0 && <Link to={`/profiles/${id}/preview`} className="rounded-full bg-warn-soft px-2.5 py-1 text-[12.5px] text-[#8f4508] no-underline hover:underline">{warnings} 条告警</Link>}
          {dirty && <Badge tone="warn">有未保存的修改</Badge>}
        </PageHeader>
      </div>
      <ErrorAlert error={save.error ?? dup.error} />
      {draft.migration && <div className="rounded-lg bg-ground px-4 py-3 text-[13px]">迁移记录：{draft.migration.reason}。迁移前配置已备份。<a className="ml-2 text-brand" href={`/api/profiles/${draft.id}/migration-backup`} download={`${draft.id}-迁移前配置.json`}>下载迁移前配置</a>{draft.migration.issues.length > 0 && ` 有 ${draft.migration.issues.length} 项历史诊断，请检查预览。`}</div>}
      <ProfileEditGuard valid={ctx.baseValid} onDiscard={discard} />
      {template.error && <ErrorAlert error={template.error} />}

      <PageScroll>
        <ProfileSections initialSection={tab} routingReady={draft.routing?.mode !== 'bound' || !!template.data} before={<TemplateCard />} overview={<TabOverview />} />
      </PageScroll>
    </ProfileContext.Provider>
  );
}
