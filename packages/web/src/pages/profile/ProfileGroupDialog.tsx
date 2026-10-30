import { useState } from 'react';
import { groupPlaceholders } from '../../schemas/placeholders.ts';
import { compileUserRegex, type GroupSpec } from '@sub-forge/core';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { Badge, Button, Field, Input, Segmented } from '../../components/ui.tsx';
import { draftIssues } from '../template/model.ts';
import { ProfileContext, useProfile, useProfileCtx } from './context.ts';
import { GroupMemberPicker } from './GroupMemberPicker.tsx';

/** 整个弹窗使用局部 Profile 草稿；成员和代理链一并应用或取消。 */
export function ProfileGroupDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const parent = useProfile();
  const [working, setWorking] = useState(() => structuredClone(parent.draft));
  const [chainEditing, setChainEditing] = useState(false);
  const [tab, setTab] = useState<'members' | 'settings'>('members');
  const { ctx } = useProfileCtx(working, setWorking);
  const routing = working.routing!;
  const bound = routing.mode === 'bound';
  const group = (bound ? ctx?.template?.groups : routing.config.groups)?.find(g => g.id === groupId);
  if (!ctx || !group) return null;
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
  return <ProfileContext.Provider value={ctx}><Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]" aria-describedby={undefined}>
    <DialogHeader className="shrink-0 border-b border-line px-5 pt-5 pb-4"><DialogTitle>{group.name || '新策略组'}</DialogTitle><div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted"><Badge>{group.type.toUpperCase()}</Badge>{bound ? <span>继承「{ctx.template?.name}」 · 填充仅影响本订阅</span> : <span>本订阅的策略组</span>}</div><fieldset disabled={chainEditing} className="m-0 border-0 p-0 pt-2"><Segmented label="策略组编辑分区" value={tab} options={[{ value: 'members', label: '成员填充' }, { value: 'settings', label: bound ? '模板组设置' : '组设置' }]} onChange={setTab} /></fieldset></DialogHeader>
    <div className="min-h-0 overflow-y-auto px-5 py-4">
      {tab === 'members' ? <GroupMemberPicker group={group} members={members} inherited={inherited} onChange={setMembers} onGroupChange={patch} readOnlySettings={bound} onChainEditingChange={setChainEditing} /> : <fieldset disabled={bound} className="m-0 flex flex-col gap-4 border-0 p-0">
        {bound && <p className="m-0 text-[13px] text-ink-muted">以下设置跟随模板，在模板中修改。</p>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="组名称">{id => <Input placeholder="在配置中标识此策略组的名称" id={id} value={group.name} onChange={e => patch({ name: e.target.value })} />}</Field><GroupSettingsFields value={group} onChange={(key, value) => patch({ [key]: value })} /><Field label="图标地址">{id => <Input placeholder={groupPlaceholders.icon} id={id} value={group.display?.icon ?? ''} onChange={e => patch({ display: { ...group.display, icon: e.target.value || undefined } })} />}</Field></div>
        <ExtraFields value={group.extra ?? {}} validateName={name => ['proxies', 'use', 'filter', 'exclude-filter', 'exclude-type', 'include-all', 'include-all-proxies', 'include-all-providers', 'dialer-proxy', 'empty-fallback'].includes(name) ? '请通过成员和前置设置编辑此字段；空组固定拒绝连接' : undefined} onChange={extra => patch({ extra })} />
      </fieldset>}
      {errors.map((e, i) => <p role="alert" key={i} className="text-[12px] text-err">{e.message}</p>)}
    </div>
    <DialogFooter className="shrink-0 border-t border-line bg-ground px-5 py-3"><span className="mr-auto self-center text-[12px] text-ink-muted">{chainEditing ? '请先应用或取消上方前置设置' : '保存订阅后生效'}</span><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!!errors.length || chainEditing} onClick={() => { parent.setDraft(working); onClose(); }}>应用到订阅</Button></DialogFooter>
  </DialogContent></Dialog></ProfileContext.Provider>;
}
