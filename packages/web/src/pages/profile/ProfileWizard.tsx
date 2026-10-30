// 单页草稿编辑：默认展示节点与分流内容，可选设置按需打开。
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, ErrorAlert, PageHeader, PageScroll } from '../../components/ui.tsx';
import { useLeaveGuard } from '../../hooks/useLeaveGuard.ts';
import { useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { draftIssues } from '../template/model.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { ProfileSections } from './ProfileSections.tsx';
import { TemplateCard } from './TemplateCard.tsx';

export function ProfileWizard() {
  const save = useSaveDoc('profiles');
  const preset = useSearchParams()[0].get('template');
  const [initial] = useState<ProfileDoc>(() => ({ id: '', name: '', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: preset ? { mode: 'bound', templateId: preset, groupAdditions: {} } : { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } }));
  const [draft, setDraft] = useState(initial);
  const { ctx, template } = useProfileCtx(draft, setDraft);
  const { blocker, leave } = useLeaveGuard(JSON.stringify(draft) !== JSON.stringify(initial) || !ctx!.baseValid, undefined, () => ({ what: '新建订阅', canSave, saveLabel: '创建并离开', onSave: () => finish(true) }));
  const templateReady = draft.routing?.mode !== 'bound' || (!!template.data && !template.isError);
  const body = draft.routing?.mode === 'independent' ? draft.routing.config : { groups: template.data?.groups ?? [], rules: draft.routing?.prependRules ?? [], final: template.data?.final ?? { kind: 'builtin' as const, name: 'DIRECT' as const } };
  const issues = draftIssues(body);
  const canSave = !!draft.name.trim() && ctx!.baseValid && templateReady && !issues.length && !save.isPending;
  const finish = async (leaving = false) => {
    if (!canSave) return;
    const { id: _id, ...profile } = draft;
    const p = await save.mutateAsync({ ...profile, name: profile.name.trim() });
    if (!leaving) leave(`/profiles/${p.id}/overview`);
  };
  return <ProfileContext.Provider value={ctx!}>
    <PageHeader crumbs={<><Link to="/profiles" className="text-ink-muted no-underline">配置订阅</Link> / 新建</>} title="新建配置订阅" actions={<Button variant="primary" disabled={!canSave} onClick={() => finish()}>{save.isPending ? '正在创建…' : '创建订阅'}</Button>}>
      <span className="text-[13px] text-ink-muted">选择节点并配置分流，保存后可创建订阅链接。</span>
    </PageHeader>
    <ErrorAlert error={save.error} />
    {!ctx!.baseValid && <div className="flex items-center justify-between gap-2 text-[13px] text-err">请修复基础设置中的 YAML，或放弃该次编辑。<Button onClick={ctx!.resetBaseEditor}>放弃无效 YAML</Button></div>}
    <PageScroll>
      <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <ProfileSections routingReady={templateReady} before={<>
          <TemplateCard />
          <ErrorAlert error={template.error} />
          {!templateReady && <div className="flex items-center gap-3 text-[13px] text-ink-muted">{template.isError ? '模板加载失败，请重试或更换模板。' : '正在加载模板…'}{template.isError && <Button onClick={() => void template.refetch()}>重试</Button>}</div>}
        </>} />
        {!!issues.length && <p role="status" className="m-0 text-[13px] text-err">{issues[0]!.message}（{issues.length} 项待补全）</p>}
      </fieldset>
    </PageScroll>
  </ProfileContext.Provider>;
}
