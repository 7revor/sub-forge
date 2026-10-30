import { profileEditorOverlay } from '@sub-forge/core';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';
import { useModalDraft } from '../../modals/index.tsx';
import { effectiveGroups, type ProfileCtx } from './context.ts';
import { persistedProfile, updateEditorOverlay } from './routing.ts';
import { nodeSetKey } from './memberModel.ts';

export type ProfileModalData = { profile: ProfileDoc; template?: TemplateDoc; nodeSets: ProfileCtx['allNodeSets'] };
/** 只传可克隆数据，不传页面的 setter、Context 或查询缓存。 */
export function profileModalData(ctx: ProfileCtx): ProfileModalData {
  return { profile: persistedProfile(ctx.draft), template: ctx.template, nodeSets: ctx.allNodeSets };
}
export function useModalProfile(data: ProfileModalData) {
  const [working, setWorking] = useModalDraft(data.profile);
  const overlay = profileEditorOverlay(working);
  const groups = effectiveGroups(data.template, overlay);
  const nodeSetName = (ref: ProfileCtx['allNodeSets'][number]['ref']) => data.nodeSets.find(n => nodeSetKey(n.ref) === nodeSetKey(ref))?.name ?? ref.id;
  const ctx: ProfileCtx = {
    draft: { ...working, overlay }, setDraft: next => setWorking(persistedProfile(next)),
    patchOverlay: fn => setWorking(updateEditorOverlay(working, fn)), template: data.template, groups,
    groupOptions: groups.map(g => ({ id: g.id, name: g.name })), groupName: id => groups.find(g => g.id === id)?.name ?? id,
    profileNodeSets: working.nodeSets.map(n => ({ ref: n.ref, name: nodeSetName(n.ref) })), allNodeSets: data.nodeSets, nodeSetName,
  };
  return { working, setWorking, ctx };
}
