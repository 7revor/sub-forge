// 管理接口客户端：同源请求，会话靠 cookie。401 时通知外层跳转到登录页。

import type { ReportItem } from '@sub-forge/core';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => { unauthorizedListeners.add(fn); return () => { unauthorizedListeners.delete(fn); }; };

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') unauthorizedListeners.forEach((fn) => fn());
    const err = data as { error?: string; details?: unknown } | undefined;
    throw new ApiError(res.status, err?.error ?? `请求失败（HTTP ${res.status}）`, err?.details);
  }
  return data as T;
}

// ---------- 接口返回的类型 ----------

export type User = { id: string; username: string; role: 'admin' | 'user'; disabled: boolean; scriptAllowed: boolean; createdAt: number };
export type TokenItem = { token: string; profileId: string; label?: string; createdAt: number; url: string };
export type AccessLogRow = { at: number; ua: string; client: string; platform?: string; status: number; ms: number; warnings: number; source: string; token: string };
export type SnapshotMeta = { id: number; url: string; fetchedAt: number; ok: boolean; status?: number; hash?: string; userinfo?: { upload?: number; download?: number; total?: number; expire?: number }; error?: string };
export type NodeBrief = { name: string; type: string; server: string; port: number };
export type NodeListResult = { nodes: NodeBrief[]; total: number; truncated: boolean; report: ReportItem[] };
export type TraceStep = { index: number; op: string; enabled: boolean; before: number; after: number; renamed: { from: string; to: string }[]; removed: string[]; error?: string; nodes: NodeBrief[]; origins: (number | null)[]; truncated: boolean };
export type PipelinePreview = { input: number; inputNodes: NodeBrief[]; failures: { line: string; reason: string }[]; report: ReportItem[]; trace: TraceStep[]; nodes: NodeBrief[] };
export type DependencyEntry = { refKey: string; nodeSet: string; node: string; strategy: 'wrap' | 'copy' | 'inline'; output: string; usedBy: string[] };
export type ProfilePreview = { ok: boolean; yaml?: string; exportYaml?: string; dependencies?: DependencyEntry[]; report: ReportItem[]; failure?: string };
export type ImpactEntry = { profileId: string; profileName: string; owner: string | null; level: 'error' | 'warn'; forceable?: boolean; issues: ReportItem[] };
export type RejectedRuleDetail = { line: number; text: string; reason: string };
/** 规则集预览中每个来源的拉取 / 解析状态；不支持的行最多返回前 100 条详情 */
export type RulesetSourceStatus = { format?: string; behavior?: string; conversion?: 'yaml-to-list'; id: string; ok: boolean; error?: string; fetchedAt?: number; stale?: boolean; passthrough?: boolean; rules?: number; rejected?: number; rejectedDetails?: RejectedRuleDetail[] };
export type RulesetPreview = {
  delivery?: { mode: 'original'; format: string; behavior: string } | { mode: 'managed' } | { mode: 'unsupported'; reason: string };
  sources: RulesetSourceStatus[];
  passthrough: boolean; lines: string[]; total?: number;
  dropped: { rule: string; reason: string }[]; notes?: string[]; rejected: { line: number; text: string; reason: string }[]; error?: string;
  /** 只在合并结果中出现 */
  stats?: { domain: number; classical: number; ipcidr: number; total: number; duplicates: number };
  passthroughSources?: { sourceId: string; name: string; format: string }[];
};

// ---------- 仓库与系统接口；Pending 标注的功能仍为占位（见 docs/11） ----------
export type Pending = { pending?: boolean };
export type UserStats = Pending & { items: Record<string, { profiles: number; sources: number; lastRequestAt?: number }> };
export type Share = { id: string; kind: 'source' | 'collection'; docId: string; name: string; to: string[] };
export type RepoScan = { ref: string; directory: string; include: string[]; exclude: string[]; format: string; client: 'any' | 'mihomo' | 'surge'; groupBy: 'path' | 'directory' | 'stem'; readme: boolean; preferred: string[] };
export type RuleRepo = { id: string; name: string; url: string; refs: string[]; scans: RepoScan[]; license: string; configRevision: string; pending: boolean; enabled: boolean; entries: number; builtAt?: number; checkedAt?: number; error?: string; indexing: boolean };
export type RepoEntry = { repo: string; path: string; name: string; count?: number; clients?: string[] };
export type RepoFileEntry = RepoEntry & { filePath: string; ref: string; url: string };
export type RepoFilePreview = { repo: string; entry?: string; ref: string; path: string; name: string; content: string; url: string; upstream: string; license: string };
export type RuleCatalog = {
  repositories: { id: string; name: string; complete: boolean; nodes: { kind: 'file' | 'directory'; ref: string; root: string; path: string; entry?: string }[] }[];
  locals: { id: string; name: string; hint: string }[];
  notices: string[];
};
export type RepoFileList = RepoEntry & { license?: string; url: string; files: { ref: string; path: string; url: string; upstream: string; format: string }[] };
export type RepoEntryDetail = RepoEntry & { rejected?: number; rejectedDetails?: RejectedRuleDetail[]; license?: string; url: string; previewError?: string; variants: { id: string; client: string; label: string; recommended?: boolean; file: string; how: string; files: { path: string; url: string; upstream: string; format: string }[] }[]; preview: string[] };
export type SystemInfo = Pending & {
  ssrfAllow: { value: string; note?: string }[];
  verify: { enabled: boolean; version?: string; checks24h?: number; fails24h?: number } | null;
  lastBackup: { at: number; size: number } | null;
};
