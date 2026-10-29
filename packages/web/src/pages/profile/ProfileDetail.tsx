// Profile 详情：头部 + 分区标签（概览 / 基础设置 / 节点集 / 策略组 / 规则 / 代理链 / 预览）。
// 除"概览"中的订阅链接外，各标签编辑同一份草稿，统一用右上角"保存"提交。

import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { DeleteMenu } from '../../components/MoreMenu.tsx';
import { Badge, Button, ErrorBox, PageHeader, cx } from '../../components/ui.tsx';
import { useDeleteDoc, useDoc, useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { TabBase, TabNodeSets, TabOverview } from './TabsBasic.tsx';
import { TabChains, TabPreview } from './TabsChain.tsx';
import { TabGroups } from './TabGroups.tsx';
import { TabRules } from './TabRules.tsx';
import { ProfileEditGuard } from './ProfileEditGuard.tsx';

const TABS = [
  ['overview', '概览'], ['base', '基础设置'], ['nodesets', '节点集'], ['groups', '策略组'], ['rules', '规则'], ['chains', '代理链'], ['preview', '预览'],
] as const;

export function ProfileDetail() {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const doc = useDoc('profiles', id);
  const save = useSaveDoc('profiles');
  const del = useDeleteDoc('profiles');
  const [draft, setDraft] = useState<ProfileDoc>();
  useEffect(() => { if (doc.data) setDraft(doc.data); }, [doc.data]);

  const { ctx, template } = useProfileCtx(draft, setDraft);

  if (!draft || !ctx) return doc.error ? <ErrorBox error={doc.error} /> : <div className="text-muted">加载中…</div>;
  const dirty = !ctx.baseValid || JSON.stringify(draft) !== JSON.stringify(doc.data);
  const discard = () => { setDraft(doc.data); ctx.resetBaseEditor(); };

  return (
    <ProfileContext.Provider value={ctx}>
      <div className="flex flex-col gap-2.5">
        <PageHeader crumbs={<><Link to="/profiles" className="text-muted no-underline">配置订阅</Link> / {draft.name}</>} title={draft.name}
          actions={<>
            {dirty && <Button onClick={discard}>放弃修改</Button>}
            <DeleteMenu what="配置订阅" name={draft.name} body="它的所有订阅链接会立即失效，客户端将无法更新。" error={del.error} pending={del.isPending}
              onReset={del.reset} onDelete={() => del.mutate(draft.id, { onSuccess: () => navigate('/profiles') })} />
            <Button variant="primary" disabled={!ctx.baseValid || !dirty || save.isPending} onClick={() => { if (ctx.baseValid) save.mutate(draft); }}>{save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
          </>}>
          {draft.template && <Badge tone="accent">模板 {template.data?.name ?? draft.template.id} v{template.data?.version ?? '?'} · {draft.template.follow === 'latest' ? '跟随最新' : '锁定'}</Badge>}
          {dirty && <Badge tone="warn">有未保存的修改</Badge>}
        </PageHeader>
        <nav aria-label="Profile 分区" className="flex flex-wrap border-b border-line">
          {TABS.map(([key, label]) => (
            <NavLink key={key} to={`/profiles/${id}/${key}`} className={() => cx('mr-5 inline-flex h-11 items-center border-b-2 px-1 text-[14px] no-underline', tab === key ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink')} aria-current={tab === key ? 'page' : undefined}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <ErrorBox error={save.error} />
      <ProfileEditGuard valid={ctx.baseValid} onDiscard={discard} />
      {template.error && <ErrorBox error={template.error} />}

      {tab === 'overview' && <TabOverview />}
      {tab === 'base' && <TabBase />}
      {tab === 'nodesets' && <TabNodeSets />}
      {tab === 'groups' && <TabGroups />}
      {tab === 'rules' && <TabRules />}
      {tab === 'chains' && <TabChains />}
      {tab === 'preview' && <TabPreview />}

    </ProfileContext.Provider>
  );
}
