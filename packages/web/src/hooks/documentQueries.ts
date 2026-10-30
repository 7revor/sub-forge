import { queryUrl } from '@sub-forge/core';
import { queryOptions } from '@tanstack/react-query';
import { api, type AccessLogRow, type SnapshotMeta, type TokenItem } from '../api.ts';

/** 页面与总览批量查询共享缓存键及返回结构。 */
export const tokenOptions = (id: string | undefined) => queryOptions({
  queryKey: ['subscription-link', id], enabled: !!id,
  queryFn: () => api<{ item: TokenItem }>('GET', queryUrl('/profiles/link', { id })).then((r) => [r.item]),
});
export const accessLogOptions = (id: string | undefined) => queryOptions({
  queryKey: ['access-log', id], enabled: !!id,
  queryFn: () => api<{ items: AccessLogRow[] }>('GET', queryUrl('/profiles/access-log', { id })).then((r) => r.items),
});
export const snapshotOptions = (id: string | undefined) => queryOptions({
  queryKey: ['snapshots', id], enabled: !!id,
  queryFn: () => api<{ items: SnapshotMeta[] }>('GET', queryUrl('/sources/snapshots', { id })).then((r) => r.items),
});
