import { profileEditorOverlay } from '@sub-forge/core';
import { persistedProfile, updateEditorOverlay } from './routing.ts';
// Profile 详情各标签页共享的状态：草稿、模板、有效组、名称查询。

import type { GroupSpec, NodeSetID, Overlay } from '@sub-forge/core';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api.ts';
import { useNodeSetNames, type GroupOption } from '../../components/pickers.tsx';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';

export type ProfileCtx = {
  draft: ProfileDoc;
  setDraft: (p: ProfileDoc) => void;
  baseValid: boolean;
  setBaseValid: (valid: boolean) => void;
  baseEditorKey: number;
  resetBaseEditor: () => void;
  patchOverlay: (fn: (o: Overlay) => Overlay) => void;
  template: TemplateDoc | undefined;
  /** 模板组 + 私有组（按输出顺序），用于各种选择器 */
  groups: (GroupSpec & { origin: 'template' | 'profile' })[];
  groupOptions: GroupOption[];
  groupName: (id: string) => string;
  /** 已加入本 Profile 的节点集 */
  profileNodeSets: { ref: NodeSetID; name: string }[];
  allNodeSets: { ref: NodeSetID; name: string }[];
  nodeSetName: (r: NodeSetID) => string;
};

export const ProfileContext = createContext<ProfileCtx | null>(null);

export function useProfile(): ProfileCtx {
  const c = useContext(ProfileContext);
  if (!c) throw new Error('ProfileContext 未提供');
  return c;
}

/** 计算有效组顺序：模板组在前，私有组按 after 锚点插入（与内核 mergeTemplate 一致） */
export function effectiveGroups(template: TemplateDoc | undefined, overlay: Overlay): ProfileCtx['groups'] {
  const groups: ProfileCtx['groups'] = (template?.groups ?? []).map((g) => ({ ...g, origin: 'template' as const }));
  for (const { after, group } of overlay.extraGroups ?? []) {
    const at = after === undefined ? -1 : groups.findIndex((g) => g.id === after);
    const eg = { ...group, origin: 'profile' as const };
    if (at < 0) groups.push(eg); else groups.splice(at + 1, 0, eg);
  }
  return groups;
}

/** 详情页和新建向导共用模板查询与草稿派生状态。 */
export function useProfileCtx(draft: ProfileDoc | undefined, setDraft: (p: ProfileDoc) => void) {
  const [baseValid, setBaseValid] = useState(true);
  const [baseEditorKey, setBaseEditorKey] = useState(0);
  const resetBaseEditor = useCallback(() => { setBaseValid(true); setBaseEditorKey(key => key + 1); }, []);
  const templateId = draft?.routing?.mode === 'bound' ? draft.routing.templateId : draft?.routing ? undefined : draft?.template?.id;
  const template = useQuery({
    queryKey: ['template', templateId],
    enabled: !!templateId,
    queryFn: () => api<{ item: TemplateDoc }>('GET', `/templates/${templateId}`),
    select: result => result.item,
  });
  const { all, nameOf } = useNodeSetNames();

  const ctx = useMemo<ProfileCtx | undefined>(() => {
    if (!draft) return undefined;
    const overlay = profileEditorOverlay(draft);
    const groups = effectiveGroups(template.data, overlay);
    return {
      draft: { ...draft, overlay }, setDraft: (next) => setDraft(persistedProfile(next)), baseValid, setBaseValid, baseEditorKey, resetBaseEditor,
      patchOverlay: (fn: (o: Overlay) => Overlay) => setDraft(updateEditorOverlay(draft, fn)),
      template: template.data,
      groups,
      groupOptions: groups.map((g) => ({ id: g.id, name: g.name })),
      groupName: (gid: string) => groups.find((g) => g.id === gid)?.name ?? `（已不存在：${gid}）`,
      profileNodeSets: draft.nodeSets.map((n) => ({ ref: n.ref, name: nameOf(n.ref) })),
      allNodeSets: all,
      nodeSetName: nameOf,
    };
  }, [draft, setDraft, template.data, all, nameOf, baseValid, baseEditorKey, resetBaseEditor]);

  return { ctx, template };
}
