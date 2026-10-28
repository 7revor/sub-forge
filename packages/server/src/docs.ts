// 服务层保存的文档类型：在内核领域模型上补充拉取参数、模板引用、基础设置等服务层字段。

import type { Collection, LocalProxyGroup, Profile, RuleBundle, RuleSet, Source, Template } from '@sub-forge/core';

export type FetchOptions = {
  /** 拉取时使用的 User-Agent */
  ua?: string;
  timeoutMs?: number;
  /** 快照有效期，过期后后台刷新（SRC-02） */
  ttlSec?: number;
};

export type SourceDoc = Source & { fetch?: FetchOptions };
export type RuleSetDoc = RuleSet & { fetch?: FetchOptions };
export type CollectionDoc = Collection;
export type LocalDoc = LocalProxyGroup;
export type BundleDoc = RuleBundle;

/** 模板的一个版本；同一模板的多个版本共用 id */
export type TemplateVersionDoc = Template & { name?: string };

/** 基础设置预设（BS-03），首期只有 mihomo 段 */
export type PresetDoc = { id: string; name: string; version: number; mihomo: Record<string, unknown> };

export type ProfileDoc = Profile & {
  template?: { id: string; follow: 'latest' | { pinned: number } };
  /** 不设置表示不输出基础设置（使用客户端默认） */
  base?: { presetId?: string; patch?: Record<string, unknown> };
  /** 订阅更新间隔（秒），写入 profile-update-interval，默认 86400（OUT-01 / OUT-02） */
  updateIntervalSec?: number;
  /** subscription-userinfo 的来源（SRC-05） */
  userinfo?: { mode: 'sum' } | { mode: 'source'; sourceId: string } | { mode: 'none' };
};

export type TokenDoc = { token: string; profileId: string; label?: string };

/** 种子文件：一次性导入全部文档 */
export type Seed = {
  sources?: SourceDoc[];
  collections?: CollectionDoc[];
  locals?: LocalDoc[];
  rulesets?: RuleSetDoc[];
  bundles?: BundleDoc[];
  presets?: PresetDoc[];
  templates?: TemplateVersionDoc[];
  profiles?: ProfileDoc[];
  tokens?: TokenDoc[];
};

export type DocKind = 'source' | 'collection' | 'local' | 'ruleset' | 'bundle' | 'preset' | 'profile';

export type DocTypes = {
  source: SourceDoc;
  collection: CollectionDoc;
  local: LocalDoc;
  ruleset: RuleSetDoc;
  bundle: BundleDoc;
  preset: PresetDoc;
  profile: ProfileDoc;
};
