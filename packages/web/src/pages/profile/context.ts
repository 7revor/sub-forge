import { queryUrl } from '@sub-forge/core';
import { editableProfileGroups } from './routing.ts';
// Profile 详情各标签页共享的状态：草稿、模板、有效组、名称查询。

import type { GroupSpec, NodeSetID } from '@sub-forge/core';
import { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api.ts';
import { useNodeSetNames, type GroupOption } from '../../components/pickers.tsx';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';

export type ProfileCtx = {
  draft: ProfileDoc;
  setDraft: (p: ProfileDoc) => void;
  template: TemplateDoc | undefined;
  /** 模板原始组与订阅独立组；追加成员由成员编辑器单独展示。 */
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

/** 详情页共用模板查询与草稿派生状态。 */
export function useProfileCtx(draft: ProfileDoc | undefined, setDraft: (p: ProfileDoc) => void) {
  const templateId = draft?.routing.mode === 'bound' ? draft.routing.templateId : undefined;
  const template = useQuery({
    queryKey: ['template', templateId],
    enabled: !!templateId,
    queryFn: () => api<{ item: TemplateDoc }>('GET', queryUrl('/templates', { id: templateId })),
    select: result => result.item,
  });
  const { all, nameOf } = useNodeSetNames();

  const ctx = useMemo<ProfileCtx | undefined>(() => {
    if (!draft) return undefined;
    const groups = editableProfileGroups(draft, template.data);
    return {
      draft, setDraft,
      template: template.data,
      groups,
      groupOptions: groups.map((g) => ({ id: g.id, name: g.name })),
      groupName: (gid: string) => groups.find((g) => g.id === gid)?.name ?? `（已不存在：${gid}）`,
      profileNodeSets: draft.nodeSets.map((n) => ({ ref: n.ref, name: nameOf(n.ref) })),
      allNodeSets: all,
      nodeSetName: nameOf,
    };
  }, [draft, setDraft, template.data, all, nameOf]);

  return { ctx, template };
}
