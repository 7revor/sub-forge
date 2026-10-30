import { useState } from 'react';
import { useModalProfile, type ProfileModalData } from './modalProfile.ts';
import type { ProfileDoc } from '../../hooks.ts';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { groupPlaceholders } from '../../schemas/placeholders.ts';
import { compileUserRegex, type GroupSpec } from '@sub-forge/core';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { Badge, Button, Field, Input } from '../../components/ui.tsx';
import { draftIssues } from '../template/model.ts';
import { ProfileContext } from './context.ts';
import { GroupMemberPicker } from './GroupMemberPicker.tsx';

/** 整个弹窗使用局部 Profile 草稿；成员和代理链一并应用或取消。 */
export const ProfileGroupDialog = createModal<ProfileModalData & { groupId: string }, ProfileDoc>(function ProfileGroup({ data, modal }) {
  const { groupId } = data;
  const { working, setWorking, ctx } = useModalProfile(data);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const [chainEditing, setChainEditing] = useModalDraft(false);
  const routing = working.routing!;
  const bound = routing.mode === 'bound';
  const group = (bound ? ctx?.template?.groups : routing.config.groups)?.find(g => g.id === groupId);
  if (!ctx || !group) throw new Error('策略组不存在，请重新打开');
  const members = bound ? routing.groupAdditions[group.id] ?? [] : group.members;
  const inherited = bound ? group.members : [];
  const patch = (value: Partial<GroupSpec>) => {
    if (routing.mode === 'independent') setWorking({ ...working, routing: { ...routing, config: { ...routing.config, groups: routing.config.groups.map(g => g.id === groupId ? { ...g, ...value } : g) } } });
  };
  const setMembers = (next: GroupSpec['members']) => bound ? setWorking({ ...working, routing: { ...routing, groupAdditions: { ...routing.groupAdditions, [groupId]: next } } }) : patch({ members: next });
  const body = routing.mode === 'independent' ? routing.config : { groups: ctx.template?.groups ?? [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
  const errors = draftIssues(body).filter(r => r.where === `group:${groupId}` && r.level === 'error');
  for (const [name, value] of [['filter', group.filter], ['exclude-filter', group.excludeFilter]]) {
    if (value) try { compileUserRegex(value); } catch (error) { errors.push({ level: 'error', code: 'group.filter', message: `${name} 无效：${(error as Error).message}` }); }
  }
  return <ProfileContext.Provider value={ctx}><ModalContent className="flex h-[min(800px,calc(100dvh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]" aria-describedby={undefined}>
    <ModalHeader className="shrink-0 border-b border-line px-5 pt-5 pb-4"><ModalTitle>{group.name || '新策略组'}</ModalTitle><div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted"><Badge>{group.type.toUpperCase()}</Badge>{bound ? <span>继承「{ctx.template?.name}」 · 填充仅影响本订阅</span> : <span>本订阅的策略组</span>}</div></ModalHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="flex flex-col gap-4">
        <fieldset disabled={bound || chainEditing} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2"><Field label="组名称">{id => <Input disabled={bound} placeholder="在配置中标识此策略组的名称" id={id} value={group.name} onChange={e => patch({ name: e.target.value })} />}</Field><GroupSettingsFields disabled={bound} section="type" value={group} onChange={(key, value) => patch({ [key]: value })} /></fieldset>
        <GroupMemberPicker group={group} members={members} inherited={inherited} onChange={setMembers} onGroupChange={patch} readOnlySettings={bound} onChainEditingChange={setChainEditing} footerTarget={footerTarget} />
        <details><summary className="cursor-pointer text-[13px] font-medium">高级设置</summary><fieldset disabled={bound || chainEditing} className="m-0 mt-4 flex flex-col gap-4 border-0 p-0">
          {bound && <p className="m-0 text-[13px] text-ink-muted">以下设置跟随模板，在模板中修改。</p>}
          <div className="grid gap-4 sm:grid-cols-2"><GroupSettingsFields disabled={bound} section="advanced" value={group} onChange={(key, value) => patch({ [key]: value })} /><Field label="图标地址">{id => <Input placeholder={groupPlaceholders.icon} id={id} value={group.display?.icon ?? ''} onChange={e => patch({ display: { ...group.display, icon: e.target.value || undefined } })} />}</Field>
            <Field label="保留名称（filter）">{id => <Input id={id} placeholder="按正则表达式筛选动态成员的节点名称" value={group.filter ?? ''} onChange={e => patch({ filter: e.target.value || undefined })} />}</Field>
            <Field label="排除名称（exclude-filter）">{id => <Input id={id} placeholder="排除名称匹配此正则表达式的节点" value={group.excludeFilter ?? ''} onChange={e => patch({ excludeFilter: e.target.value || undefined })} />}</Field>
            <Field label="排除协议">{id => <ExcludeTypeSelect disabled={bound} id={id} value={group.excludeType} onChange={excludeType => patch({ excludeType })} />}</Field>
          </div>
          <ExtraFields value={group.extra ?? {}} validateName={name => ['proxies', 'use', 'filter', 'exclude-filter', 'exclude-type', 'include-all', 'include-all-proxies', 'include-all-providers', 'dialer-proxy', 'empty-fallback'].includes(name) ? '请通过成员和前置设置编辑此字段；空组固定拒绝连接' : undefined} onChange={extra => patch({ extra })} />
        </fieldset></details>
      </div>
      {errors.map((e, i) => <p role="alert" key={i} className="text-[12px] text-err">{e.message}</p>)}
    </div>
    <ModalFooter className="h-[105px] shrink-0 flex-row flex-wrap items-center border-t border-line bg-ground px-5 py-3 sm:h-[65px]"><div ref={setFooterTarget} className="flex w-full flex-wrap items-center justify-end gap-2">{!chainEditing && <><span className="mr-auto w-full self-center text-[12px] text-ink-muted sm:w-auto">保存订阅后生效</span><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!!errors.length} onClick={() => modal.confirm(working)}>保存</Button></>}</div></ModalFooter>
  </ModalContent></ProfileContext.Provider>;
});
