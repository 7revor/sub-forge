import { queryOptions } from '@tanstack/react-query';
import { api, type AccessLogRow, type SnapshotMeta, type TokenItem } from '../api.ts';

/** 页面与总览批量查询共享缓存键及返回结构。 */
export const tokenOptions = (id: string | undefined) => queryOptions({
  queryKey: ['subscription-link', id], enabled: !!id,
  queryFn: () => api<{ item: TokenItem }>('GET', `/profiles/${encodeURIComponent(id!)}/link`).then((r) => [r.item]),
});
export const accessLogOptions = (id: string | undefined) => queryOptions({
  queryKey: ['access-log', id], enabled: !!id,
  queryFn: () => api<{ items: AccessLogRow[] }>('GET', `/profiles/${encodeURIComponent(id!)}/access-log`).then((r) => r.items),
});
export const snapshotOptions = (id: string | undefined) => queryOptions({
  queryKey: ['snapshots', id], enabled: !!id,
  queryFn: () => api<{ items: SnapshotMeta[] }>('GET', `/sources/${encodeURIComponent(id!)}/snapshots`).then((r) => r.items),
});
