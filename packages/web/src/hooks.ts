import { snapshotOptions } from './hooks/documentQueries.ts';
import { sourceFetchSummary } from './domain/sourceFetch.ts';
// 数据读写的 React Query 封装。文档种类与后端 /api/{kind} 一一对应。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Collection, LocalProxyGroup, RuleSet, RuleSetSource, Source, Template } from '@sub-forge/core';
import { api, type User } from './api.ts';

export type FetchOptions = { ua?: string; timeoutMs?: number; ttlSec?: number };
/** 节点订阅源仅配置自动更新间隔，拉取身份和超时固定。 */
export type SourceFetchOptions = Pick<FetchOptions, 'ttlSec'>;
export type SourceDoc = Source & { fetch?: SourceFetchOptions };
export type RuleSetSourceDoc = RuleSetSource & { fetch?: FetchOptions };
export type RuleSetDoc = Omit<RuleSet, 'sources'> & { sources: RuleSetSourceDoc[] };
export type PresetDoc = { id: string; name: string; version: number; mihomo: Record<string, unknown> };
export type TemplateDoc = Template & { name?: string };
export type ProfileDoc = import('@sub-forge/core').Profile & {
  template?: { id: string; follow: 'latest' | { pinned: number } };
  /** raw：原样片段（追加到末尾；服务端尚未输出，见 docs/11） */
  base?: { presetId?: string; patch?: Record<string, unknown>; raw?: string };
  updateIntervalSec?: number;
  userinfo?: { mode: 'sum' } | { mode: 'source'; sourceId: string } | { mode: 'none' };
};

export type DocMap = {
  sources: SourceDoc;
  collections: Collection;
  locals: LocalProxyGroup;
  rulesets: RuleSetDoc;
  profiles: ProfileDoc;
  presets: PresetDoc;
};
export type Kind = keyof DocMap;

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('GET', '/me').then((r) => r.user), retry: false, staleTime: 60_000 });
/** 引用候选包含管理员维护的公共规则集，维护列表仍只显示自己的文档。 */
export const useRuleSetRefs = () => useQuery({ queryKey: ['ruleset-refs'], queryFn: () => api<{ items: { id: string; name: string }[] }>('GET', '/rule-options/locals').then(r => r.items) });

export function useList<K extends Kind>(kind: K) {
  return useQuery({ queryKey: [kind], queryFn: () => api<{ items: DocMap[K][] }>('GET', `/${kind}`).then((r) => r.items) });
}

export function useDoc<K extends Kind>(kind: K, id: string | undefined) {
  return useQuery({ queryKey: [kind, id], enabled: !!id && id !== 'new', queryFn: () => api<{ item: DocMap[K] }>('GET', `/${kind}/${id}`).then((r) => r.item) });
}

/** 新建（无 id）或更新；成功后刷新列表与该文档 */
export function useSaveDoc<K extends Kind>(kind: K) {
  const qc = useQueryClient();
  return useMutation({ meta: { successMessage: '已保存' },
    mutationFn: (doc: Partial<DocMap[K]> & { id?: string }) =>
      (doc.id ? api<{ item: DocMap[K] }>('PUT', `/${kind}/${doc.id}`, doc) : api<{ item: DocMap[K] }>('POST', `/${kind}`, doc)).then((r) => r.item),
    onSuccess: (item) => {
      qc.setQueryData([kind, (item as { id: string }).id], item);
      void qc.invalidateQueries({ queryKey: [kind] });
    },
  });
}

export function useDeleteDoc(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({ meta: { successMessage: '已删除' },
    mutationFn: (id: string) => api('DELETE', `/${kind}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [kind] }),
  });
}

export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api<{ items: TemplateDoc[] }>('GET', '/templates').then((r) => r.items) });

export function useNodeList(ref: import('@sub-forge/core').NodeSetID | undefined) {
  return useQuery({
    queryKey: ['nodes', ref?.type, ref?.id],
    enabled: !!ref?.id,
    staleTime: 30_000,
    queryFn: () => api<import('./api.ts').NodeListResult>('GET', `/nodesets/${ref!.type}/${encodeURIComponent(ref!.id)}/nodes`),
  });
}

/** 订阅源的拉取状态：最近一次成功的快照、最近一次是否失败（与总览共用缓存） */
export function useSourceFetchState(source: SourceDoc | undefined) {
  const snaps = useQuery(snapshotOptions(source?.id));
  return { snaps, ...sourceFetchSummary(snaps.data ?? [], source?.url) };
}
