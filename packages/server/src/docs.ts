// 服务层保存的文档类型：在内核领域模型上补充拉取参数、模板引用、基础设置等服务层字段。

import type { Collection, LocalProxyGroup, Profile, RuleSet, RuleSetSource, Source, Template } from '@sub-forge/core';

export type FetchOptions = {
  /** 拉取时使用的 User-Agent */
  ua?: string;
  timeoutMs?: number;
  /** 自动更新间隔，超过后在下次读取时后台刷新 */
  ttlSec?: number;
};

/** 节点订阅源仅配置自动更新间隔，拉取身份和超时固定。 */
export type SourceFetchOptions = Pick<FetchOptions, 'ttlSec'>;
export type SourceDoc = Source & { fetch?: SourceFetchOptions };
/** 远程来源各自带拉取参数 */
export type RuleSetSourceDoc = RuleSetSource & { fetch?: FetchOptions };
export type RuleSetDoc = Omit<RuleSet, 'sources'> & { sources: RuleSetSourceDoc[] };
export type CollectionDoc = Collection;
export type LocalDoc = LocalProxyGroup;

/** 模板的一个版本；同一模板的多个版本共用 id */
export type TemplateVersionDoc = Template & { name?: string };

/** 基础设置预设（BS-03），Surge 段仅存储，暂不参与渲染 */
export type PresetDoc = { id: string; name: string; version: number; mihomo: Record<string, unknown>; surge?: { general?: Record<string, unknown>; host?: Record<string, string> } };

export type ProfileDoc = Profile & {
  revision?: number;
  /** 编辑时看到的模板版本，只做并发检查，不锁定渲染版本。 */
  templateVersion?: number;
  migration?: { reason: string; issues: import('@sub-forge/core').ReportItem[] };
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
  /** 旧格式（单一来源的 kind/url/content）读入时自动转换 */
  rulesets?: RuleSetDoc[];
  /** 已并入规则集（2026-10-29）：旧种子里的规则包读入时转成规则集 */
  bundles?: unknown[];
  presets?: PresetDoc[];
  templates?: TemplateVersionDoc[];
  profiles?: ProfileDoc[];
  tokens?: TokenDoc[];
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
