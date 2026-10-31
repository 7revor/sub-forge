import { Layers, LockKeyhole } from 'lucide-react';
import { useModalProfile, type ProfileModalData } from './modalProfile.ts';
import type { ProfileDoc } from '../../hooks.ts';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { groupPlaceholders } from '../../schemas/placeholders.ts';
import { compileUserRegex, type GroupSpec } from '@sub-forge/core';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { GROUP_TYPE_LABEL, GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { Button, Field, Input, Select, Switch } from '../../components/ui.tsx';
import { draftIssues } from '../template/model.ts';
import { ProfileContext } from './context.ts';
import { GroupMemberPicker } from './GroupMemberPicker.tsx';

/** 整个弹窗使用局部 Profile 草稿；成员和代理链一并应用或取消。 */
export const ProfileGroupDialog = createModal<ProfileModalData & { groupId: string }, ProfileDoc>(function ProfileGroup({ data, modal }) {
  const { groupId } = data;
  const { working, setWorking, ctx } = useModalProfile(data);
  const routing = working.routing!;
  const group = ctx?.groups.find(g => g.id === groupId);
  const bound = routing.mode === 'bound' && group?.origin === 'template';
  if (!ctx || !group) throw new Error('策略组不存在，请重新打开');
  const members = bound && routing.mode === 'bound' ? routing.groupAdditions[group.id] ?? [] : group.members;
  const inherited = bound ? group.members : [];
  const patch = (value: Partial<GroupSpec>) => {
    if (routing.mode === 'bound' && !bound) setWorking({ ...working, routing: { ...routing, extraGroups: (routing.extraGroups ?? []).map(g => g.id === groupId ? { ...g, ...value } : g) } });
    if (routing.mode === 'independent') setWorking({ ...working, routing: { ...routing, config: { ...routing.config, groups: routing.config.groups.map(g => g.id === groupId ? { ...g, ...value } : g) } } });
  };
  const setMembers = (next: GroupSpec['members']) => bound && routing.mode === 'bound' ? setWorking({ ...working, routing: { ...routing, groupAdditions: { ...routing.groupAdditions, [groupId]: next } } }) : patch({ members: next });
  const body = routing.mode === 'independent' ? routing.config : { groups: ctx.groups, rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
  const errors = draftIssues(body).filter(r => r.where === `group:${groupId}` && r.level === 'error');
  if (ctx.groups.some(g => g.id !== group.id && g.name.trim() === group.name.trim())) errors.push({ level: 'error', code: 'group.name', message: '策略组名称不能重复' });
  for (const [name, value] of [['filter', group.filter], ['exclude-filter', group.excludeFilter]]) {
    if (value) try { compileUserRegex(value); } catch (error) { errors.push({ level: 'error', code: 'group.filter', message: `${name} 无效：${(error as Error).message}` }); }
  }
  return <ProfileContext.Provider value={ctx}><ModalContent className="flex h-[min(800px,calc(100dvh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]" aria-describedby={undefined}>
    <ModalHeader className="shrink-0 flex-row flex-wrap items-center gap-3 border-b border-line-2 px-5 py-4 pr-14">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-soft text-ink-muted"><Layers size={16} /></span>
      {bound ? <ModalTitle className="flex items-center gap-1.5">{group.name}<LockKeyhole size={14} className="text-faint" aria-label="名称来自模板" /></ModalTitle> : <><ModalTitle className="sr-only">编辑策略组</ModalTitle><label className="min-w-0"><span className="sr-only">组名称</span><Input className="w-44" aria-label="组名称" placeholder="输入策略组名称" value={group.name} onChange={event => patch({ name: event.target.value })} /></label></>}
      <label className="w-[132px]"><span className="sr-only">类型</span><Select style={{ height: 30, opacity: 1 }} aria-label="类型" placeholder="选择策略组类型" disabled={bound} value={group.type} onChange={event => patch({ type: event.target.value as GroupSpec['type'] })}>{Object.entries(GROUP_TYPE_LABEL).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
      <span className="text-[length:var(--text-caption)] text-ink-muted">{group.test?.interval !== undefined && `每 ${group.test.interval} 秒测速`}{group.test?.tolerance !== undefined && ` · 容差 ${group.test.tolerance} ms`}</span>
    </ModalHeader>
    <GroupMemberPicker group={group} members={members} inherited={inherited} onChange={setMembers} onGroupChange={patch} readOnlySettings={bound} advanced={<>
        <details className="advanced-settings mt-auto border-t border-line-2 pt-3"><summary className="cursor-pointer text-[length:var(--text-body)] font-medium">高级设置 <span className="ml-2 text-[length:var(--text-caption)] font-normal text-ink-muted">测速参数、图标、其他字段</span></summary><fieldset disabled={bound} className="m-0 mt-4 flex flex-col gap-4 border-0 p-0">
          {bound && <p className="m-0 text-[length:var(--text-control)] text-ink-muted">以下设置跟随模板，在模板中修改。</p>}
          <label className="flex items-center gap-2 text-[length:var(--text-control)]"><Switch label="在客户端面板中隐藏" disabled={bound} checked={group.display?.hidden ?? false} onChange={hidden => patch({ display: { ...group.display, hidden } })} />在客户端面板中隐藏</label><div className="grid gap-4 sm:grid-cols-2"><GroupSettingsFields disabled={bound} section="advanced" value={group} onChange={(key, value) => patch({ [key]: value })} /><Field label="图标地址">{id => <Input placeholder={groupPlaceholders.icon} id={id} value={group.display?.icon ?? ''} onChange={e => patch({ display: { ...group.display, icon: e.target.value || undefined } })} />}</Field>

          </div>
          <ExtraFields value={group.extra ?? {}} validateName={name => ['proxies', 'use', 'filter', 'exclude-filter', 'exclude-type', 'include-all', 'include-all-proxies', 'include-all-providers', 'dialer-proxy', 'empty-fallback'].includes(name) ? '请通过成员和前置设置编辑此字段；空组固定拒绝连接' : undefined} onChange={extra => patch({ extra })} />
        </fieldset></details>
      {errors.map((e, i) => <p role="alert" key={i} className="text-[length:var(--text-caption)] text-err">{e.message}</p>)}
    </>} />
    <ModalFooter className="min-h-[61px] shrink-0 flex-row flex-wrap items-center border-t border-line-2 bg-panel px-6 py-3"><div className="flex w-full flex-wrap items-center justify-end gap-2"><><span className="mr-auto text-[length:var(--text-caption)] text-ink-muted">保存订阅后生效</span><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!!errors.length} onClick={() => modal.confirm(working)}>保存</Button></></div></ModalFooter>
  </ModalContent></ProfileContext.Provider>;
});
