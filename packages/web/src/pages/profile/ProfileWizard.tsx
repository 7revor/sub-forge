// 七步新建向导：所有步骤共用前端草稿，仅在完成时创建文档。

import { Check } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, ErrorBox, Field, Input, PageHeader, cx } from '../../components/ui.tsx';
import { useSaveDoc, useTemplates, type ProfileDoc } from '../../hooks.ts';
import { ProfileContext, useProfileCtx } from './context.ts';
import { TabBase, TabNodeSets } from './TabsBasic.tsx';
import { TabChains, TabPreview } from './TabsChain.tsx';
import { TabGroups } from './TabGroups.tsx';
import { TabRules } from './TabRules.tsx';
import { ProfileEditGuard } from './ProfileEditGuard.tsx';

const STEPS = ['名称与基础设置', '节点集', '模板', '填充策略组', '规则', '代理链', '预览'] as const;

export function ProfileWizard() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const save = useSaveDoc('profiles');
  // 从模板页「用这个模板新建配置订阅」进入时预选模板
  const preset = useSearchParams()[0].get('template');
  const [draft, setDraft] = useState<ProfileDoc>({ id: '', name: '', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, ...(preset ? { template: { id: preset, follow: 'latest' as const } } : {}) });
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const { ctx, template } = useProfileCtx(draft, setDraft);
  const nameValid = !!draft.name.trim();
  const templateReady = !draft.template || (!!template.data && !template.isError);
  const next = () => {
    if (!nameValid || !ctx?.baseValid || save.isPending) return;
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    setStep(nextStep);
    setReached(Math.max(reached, nextStep));
  };
  const changeTemplate = (id: string) => {
    if (id === (draft.template?.id ?? '')) return;
    const o = draft.overlay;
    const hasOverlay = Object.keys(o.groupPatches ?? {}).length || Object.keys(o.rulePatches ?? {}).length || o.extraGroups?.length || o.extraRules?.length || o.final;
    if (hasOverlay && !confirm('更换模板会清空策略组和规则的全部覆盖层（包括私有组、私有规则和最终出口），是否继续？')) return;
    const { template: _template, ...rest } = draft;
    setDraft({ ...rest, overlay: {}, ...(id ? { template: { id, follow: 'latest' } as const } : {}) });
  };
  const finish = () => {
    if (!nameValid || !ctx?.baseValid || !templateReady || save.isPending) return;
    const { id: _id, ...profile } = draft;
    save.mutate(profile, { onSuccess: (p) => navigate(`/profiles/${p.id}/overview`) });
  };

  return (
    <ProfileContext.Provider value={ctx!}>
      <PageHeader crumbs={<><Link to="/profiles" className="text-muted no-underline">配置订阅</Link> / 新建</>} title="新建配置订阅">
        <span className="text-[13px] text-muted">完成后才会保存；离开页面会丢失当前草稿。</span>
      </PageHeader>
      <ProfileEditGuard valid={ctx!.baseValid} onDiscard={ctx!.resetBaseEditor} />
      <ol aria-label="新建 Profile 步骤" className="m-0 flex shrink-0 list-none gap-2 overflow-x-auto p-0">
        {STEPS.map((label, index) => {
          const now = step === index, done = index < reached && !now;
          return (
            <li key={label} className="min-w-[140px] flex-1">
              <button type="button" aria-current={now ? 'step' : undefined} disabled={index > reached || !ctx!.baseValid || save.isPending || (index > 0 && !nameValid)} onClick={() => setStep(index)}
                className={cx('flex min-h-14 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60', now ? 'border-accent bg-[#f5f8ff]' : 'border-line bg-panel hover:bg-ground')}>
                <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[12px]', now || done ? 'bg-accent text-white' : 'bg-[#ebedf1] text-ink-2')}>{done ? <Check size={13} /> : index + 1}</span>
                <span className="text-[13.5px] font-semibold">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <fieldset disabled={save.isPending} className="page-scroll -m-1 gap-5 border-0 p-1">
        {step === 0 && <>
          <Card title="名称与基础设置">
            <Field label="名称">{(id) => <Input id={id} required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
          </Card>
          <TabBase />
        </>}
        {step === 1 && <TabNodeSets />}
        {step === 2 && <Card title="模板">
          <ErrorBox error={templates.error} />
          {templates.isPending && <p className="text-[13px] text-muted">正在加载模板…</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
            {[{ id: '', name: '空白', desc: '不使用模板，只用私有组和私有规则' }, ...(templates.data ?? []).map((t) => ({ id: t.id, name: `${t.name ?? t.id} v${t.version}`, desc: `${t.groups.length} 个组 · ${t.rules.length} 条规则` }))].map((t) => (
              <button key={t.id || 'blank'} type="button" aria-pressed={(draft.template?.id ?? '') === t.id} onClick={() => changeTemplate(t.id)}
                className={cx('flex cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3.5 py-3 text-left', (draft.template?.id ?? '') === t.id ? 'border-accent bg-[#f5f8ff]' : 'border-[#d5d9e0] bg-panel')}>
                <span className="text-[13.5px] font-semibold">{t.name}</span>
                <span className="text-[12.5px] text-muted">{t.desc}</span>
              </button>
            ))}
          </div>
          {draft.template && <p className="mt-3 mb-0 text-[12.5px] text-muted">自动跟随模板最新版本。</p>}
        </Card>}
        <ErrorBox error={template.error} />
        {step >= 3 && !templateReady && <div className="text-muted">{template.isError ? '模板加载失败，请返回模板步骤重新选择，或重试。' : '正在加载模板…'}{template.isError && <Button onClick={() => void template.refetch()}>重试</Button>}</div>}
        {templateReady && step === 3 && <TabGroups />}
        {templateReady && step === 4 && <TabRules />}
        {templateReady && step === 5 && <TabChains />}
        {templateReady && step === 6 && <TabPreview />}
      </fieldset>
      <ErrorBox error={save.error} />
      <div className="flex flex-wrap justify-end gap-2">
        {!ctx!.baseValid && <Button onClick={ctx!.resetBaseEditor}>放弃无效的 YAML</Button>}
        <Button disabled={step === 0 || !ctx!.baseValid || save.isPending} onClick={() => setStep(step - 1)}>上一步</Button>
        {step < STEPS.length - 1 ? <>
          <Button disabled={!nameValid || !ctx!.baseValid || save.isPending} onClick={next}>跳过</Button>
          <Button variant="primary" disabled={!nameValid || !ctx!.baseValid || save.isPending || (step >= 2 && !templateReady)} onClick={next}>下一步</Button>
        </> : <Button variant="primary" disabled={!nameValid || !ctx!.baseValid || !templateReady || save.isPending} onClick={finish}>{save.isPending ? '创建中…' : '完成'}</Button>}
      </div>
    </ProfileContext.Provider>
  );
}
