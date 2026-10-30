// 服务层保存的文档类型：在内核领域模型上补充拉取参数、模板引用、基础设置等服务层字段。

import type { Collection, LocalProxyGroup, Profile, RuleSet, RuleSetSource, Source, Template } from '@sub-forge/core';

export type FetchOptions = {
  /** 拉取时使用的 User-Agent */
  ua?: string;
  timeoutMs?: number;
  /** 仅兼容旧导入；保存时移除，运行时统一使用系统资源缓存时间。 */
  ttlSec?: number;
};

/** 节点订阅源旧字段兼容类型；拉取身份和超时固定，缓存周期由系统管理。 */
export type SourceFetchOptions = Pick<FetchOptions, 'ttlSec'>;
export type SourceDoc = Source & { fetch?: SourceFetchOptions };
/** 远程来源各自带拉取参数 */
export type RuleSetSourceDoc = RuleSetSource & { fetch?: FetchOptions };
export type RuleSetDoc = Omit<RuleSet, 'sources'> & { sources: RuleSetSourceDoc[] };
export type CollectionDoc = Collection;
export type LocalDoc = LocalProxyGroup;

/** 当前模板；旧 version 字段仅供导入历史数据，不参与保存和渲染。 */
export type TemplateVersionDoc = Template & { name?: string };

/** 仅用于迁移历史预设；正常 API 和渲染已不再使用 */
export type PresetDoc = { id: string; name: string; version: number; config: import('@sub-forge/core').NativeBase; migrationNotes?: string[] };

export type ProfileDoc = Profile & {
  migration?: { reason: string; issues: import('@sub-forge/core').ReportItem[] };
  template?: { id: string; follow: 'latest' | { pinned: number } };
  /** 不设置表示不输出基础设置（使用客户端默认） */
  base?: import('@sub-forge/core').ProfileBase;
  migrationNotes?: string[];
  /** 仅兼容旧导入；保存时移除，下发间隔取系统资源缓存时间。 */
  updateIntervalSec?: number;
  /** subscription-userinfo 的来源（SRC-05） */
  userinfo?: { mode: 'sum' } | { mode: 'source'; sourceId: string } | { mode: 'none' };
};

export type TokenDoc = { token: string; userId: string; createdAt?: number };
/** 旧种子仅用于导入时关联所有者，不继续发行旧订阅凭证。 */
export type LegacyTokenDoc = { token: string; profileId: string; label?: string };

/** 种子文件：一次性导入全部文档 */
export type Seed = {
  sources?: SourceDoc[];
  collections?: CollectionDoc[];
  locals?: LocalDoc[];
  /** 旧格式（单一来源的 kind/url/content）读入时自动转换 */
  rulesets?: RuleSetDoc[];
  /** 已并入规则集（2026-10-29）：旧种子里的规则包读入时转成规则集 */
  bundles?: unknown[];
  presets?: PresetDoc[];
  templates?: TemplateVersionDoc[];
  profiles?: (Omit<ProfileDoc, 'base'> & { base?: import('@sub-forge/core').ProfileBase & { presetId?: string } })[];
  tokens?: (TokenDoc | LegacyTokenDoc)[];
};

export type DocKind = 'source' | 'collection' | 'local' | 'ruleset' | 'preset' | 'profile';

export type DocTypes = {
  source: SourceDoc;
  collection: CollectionDoc;
  local: LocalDoc;
  ruleset: RuleSetDoc;
  preset: PresetDoc;
  profile: ProfileDoc;
};
