// 单页草稿编辑：默认展示节点与分流内容，可选设置按需打开。
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, ErrorAlert, Field, Input, PageHeader, PageScroll, cx } from '../../components/ui.tsx';
import { LeaveDialog } from '../../components/LeaveDialog.tsx';
import { useLeaveGuard } from '../../hooks/useLeaveGuard.ts';
import { useSaveDoc, type ProfileDoc } from '../../hooks.ts';
import { draftIssues } from '../template/model.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { TabBase, TabNodeSets } from './TabsBasic.tsx';
import { TabChains, TabPreview } from './TabsChain.tsx';
import { TabGroups } from './TabGroups.tsx';
import { TabRules } from './TabRules.tsx';
import { TemplateCard } from './TemplateCard.tsx';

const TABS = [['content', '配置内容'], ['advanced', '高级设置'], ['preview', '预览配置']] as const;

export function ProfileWizard() {
  const save = useSaveDoc('profiles');
  const preset = useSearchParams()[0].get('template');
  const [initial] = useState<ProfileDoc>(() => ({ id: '', name: '', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: preset ? { mode: 'bound', templateId: preset, groupAdditions: {} } : { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } }));
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<typeof TABS[number][0]>('content');
  const { ctx, template } = useProfileCtx(draft, setDraft);
  const { blocker, leave } = useLeaveGuard(JSON.stringify(draft) !== JSON.stringify(initial) || !ctx!.baseValid);
  const templateReady = draft.routing?.mode !== 'bound' || (!!template.data && !template.isError);
  const body = draft.routing?.mode === 'independent' ? draft.routing.config : { groups: template.data?.groups ?? [], rules: draft.routing?.prependRules ?? [], final: template.data?.final ?? { kind: 'builtin' as const, name: 'DIRECT' as const } };
  const issues = draftIssues(body);
  const canSave = !!draft.name.trim() && ctx!.baseValid && templateReady && !issues.length && !save.isPending;
  const finish = (done?: () => void) => {
    if (!canSave) return;
    const { id: _id, ...profile } = draft;
    save.mutate({ ...profile, name: profile.name.trim() }, { onSuccess: p => done ? done() : leave(`/profiles/${p.id}/overview`) });
  };
  return <ProfileContext.Provider value={ctx!}>
    <PageHeader crumbs={<><Link to="/profiles" className="text-muted no-underline">配置订阅</Link> / 新建</>} title="新建配置订阅" actions={<Button variant="primary" disabled={!canSave} onClick={() => finish()}>{save.isPending ? '正在创建…' : '创建订阅'}</Button>}>
      <span className="text-[13px] text-muted">选择节点并配置分流，保存后可创建订阅链接。</span>
    </PageHeader>
    <nav aria-label="新建订阅分区" className="flex shrink-0 gap-6 border-b border-line">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} disabled={!ctx!.baseValid || save.isPending} onClick={() => setTab(key)} className={cx('min-h-11 cursor-pointer border-b-2 px-1 text-[14px] disabled:cursor-not-allowed', tab === key ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink')}>{label}</button>)}
    </nav>
    <ErrorAlert error={save.error} />
    {!ctx!.baseValid && <div className="flex items-center justify-between gap-2 text-[13px] text-err">请修复基础设置中的 YAML，或放弃该次编辑。<Button onClick={ctx!.resetBaseEditor}>放弃无效 YAML</Button></div>}
    <PageScroll>
      <fieldset disabled={save.isPending} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        {tab === 'content' && <>
          <section className="rounded-[10px] border border-line bg-panel px-4.5 py-4"><Field label="订阅名称">{id => <Input id={id} required placeholder="例如：日常使用" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="max-w-[480px]" />}</Field></section>
          <TemplateCard />
          <TabNodeSets />
          <ErrorAlert error={template.error} />
          {!templateReady ? <div className="flex items-center gap-3 text-[13px] text-muted">{template.isError ? '模板加载失败，请重试或更换模板。' : '正在加载模板…'}{template.isError && <Button onClick={() => void template.refetch()}>重试</Button>}</div> : <><TabGroups /><TabRules /></>}
          {!!issues.length && <p role="status" className="m-0 text-[13px] text-err">{issues[0]!.message}（{issues.length} 项待补全）</p>}
        </>}
        {tab === 'advanced' && <>
          <div className="flex flex-col gap-2"><h2 className="m-0 text-[15px] font-semibold">基础设置</h2><p className="m-0 text-[13px] text-muted">按需引用预设或填写客户端设置。</p></div>
          <TabBase />
          <details className="rounded-[10px] border border-line bg-panel p-4"><summary className="cursor-pointer text-[14px] font-semibold">代理链（{draft.chains.length} 条）</summary><div className="mt-4 flex flex-col gap-5"><TabChains /></div></details>
        </>}
        {tab === 'preview' && <TabPreview />}
      </fieldset>
    </PageScroll>
    <LeaveDialog blocker={blocker} what="新建订阅" canSave={canSave} pending={save.isPending} error={save.error} saveLabel="创建并离开" onSave={finish} />
  </ProfileContext.Provider>;
}
