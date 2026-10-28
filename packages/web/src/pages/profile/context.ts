// Profile 详情各标签页共享的状态：草稿、模板、有效组、名称查询。

import type { GroupSpec, NodeSetID, Overlay } from '@sub-forge/core';
import { createContext, useContext } from 'react';
import type { GroupOption } from '../../components/pickers.tsx';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';

export type ProfileCtx = {
  draft: ProfileDoc;
  setDraft: (p: ProfileDoc) => void;
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
