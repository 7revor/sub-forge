// 领域模型（对应 docs/03 §2）。只描述"意图"，节点列表与最终配置都是渲染产物。

export type ID = string;

// ---------- 节点侧 ----------

export type NodeSetKind = 'source' | 'collection' | 'local';
export type NodeSetID = { type: NodeSetKind; id: ID };

/** 客户端无关的节点表示，字段对齐 mihomo（type/server/port 之外的字段原样保留） */
export type ProxyIR = {
  name: string;
  type: string;
  server: string;
  port: number;
  /** 上游自带的 dialer-proxy / underlying-proxy 原文，由依赖解析处理（REF-04） */
  upstreamDialer?: string;
  /** 隐式字段，输出时剥离（SRC-10） */
  _source: NodeSetID;
  _origName: string;
  _key: string;
  [k: string]: unknown;
};

export type Operator =
  | { op: 'filter.regex'; patterns: string[]; keep: boolean }
  | { op: 'filter.type'; types: string[]; keep: boolean }
  | { op: 'filter.useless'; patterns?: string[] }
  | { op: 'rename.regex'; rules: { pattern: string; flags?: string; replace: string }[] }
  | { op: 'rename.delete'; patterns: string[] }
  | { op: 'rename.affix'; prefix?: string; suffix?: string }
  | { op: 'flag'; mode: 'add' | 'remove' }
  | { op: 'sort.name'; order: 'asc' | 'desc' }
  | { op: 'sort.regex'; patterns: string[] }
  | { op: 'dedupe'; strategy: 'suffix' | 'drop'; by?: 'name' | 'key' }
  | { op: 'set'; types?: string[]; fields: Record<string, unknown> }
  | { op: 'script'; code: string };

export type OperatorStep = Operator & { enabled?: boolean };

/** 远程订阅源；手写或粘贴的节点放在本地节点组（LocalProxyGroup） */
export type Source = {
  id: ID;
  name: string;
  /** 管理备注，仅用于界面展示 */
  note?: string;
  url: string;
  pipeline: OperatorStep[];
};

export type Collection = {
  id: ID;
  name: string;
  /** 管理备注，仅用于界面展示 */
  note?: string;
  /** onFail：成员拉取失败时的处理（使用快照 / 跳过该成员 / 整体失败）；界面已提供，渲染尚未读取，见 docs/11 */
  members: { ref: NodeSetID; prefix?: string; suffix?: string; onFail?: 'snapshot' | 'skip' | 'fail' }[];
  pipeline: OperatorStep[];
};

export type LocalProxyGroup = {
  id: ID;
  name: string;
  /** 管理备注，仅用于界面展示 */
  note?: string;
  /** 用户手写的节点（不含隐式字段，解析时补上） */
  proxies: LocalProxy[];
};

/** 本地节点只录入节点信息；代理链统一在配置订阅的链规则中设置（REF-03） */
export type LocalProxy = {
  name: string;
  type: string;
  server: string;
  port: number;
  [k: string]: unknown;
};

// ---------- 引用 ----------

export type Builtin = 'DIRECT' | 'REJECT' | 'REJECT-DROP' | 'PASS';

export type NodeRef = {
  nodeSet: NodeSetID;
  match: { exact: string } | { regex: string };
  /** 解析失败时的兜底（REF-02），缺省为报错 */
  fallback?: Target | 'error';
};

export type Target =
  | { kind: 'builtin'; name: Builtin }
  | { kind: 'group'; groupId: ID }
  | { kind: 'node'; ref: NodeRef };

// ---------- 规则侧 ----------

export const CLIENTS = ['mihomo', 'surge', 'stash', 'loon'] as const;
export type Client = typeof CLIENTS[number];
export type IniClient = Extract<Client, 'surge' | 'loon'>;
export const isIniClient = (client: Client): client is IniClient => client === 'surge' || client === 'loon';
export type YamlClient = Extract<Client, 'mihomo' | 'stash'>;
export type Platform = 'android' | 'macos' | 'windows' | 'ios' | 'linux';

export type DomainRuleType = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'DOMAIN-WILDCARD' | 'DOMAIN-REGEX';
export type IpRuleType = 'IP-CIDR' | 'IP-CIDR6' | 'IP-ASN' | 'SRC-IP-CIDR';

export type RuleIR = (
  | { type: DomainRuleType; value: string }
  | { type: IpRuleType; value: string; noResolve?: boolean; src?: boolean }
  | { type: 'GEOSITE'; value: string }
  | { type: 'USER-AGENT'; value: string }
  | { type: 'URL-REGEX'; value: string }
  | { type: 'GEOIP'; value: string; noResolve?: boolean; src?: boolean }
  | { type: 'DST-PORT' | 'SRC-PORT'; value: string }
  | { type: 'NETWORK'; value: 'tcp' | 'udp' }
  | { type: 'PROCESS'; kind: 'name' | 'path'; mode: 'exact' | 'wildcard' | 'regex'; value: string }
  | { type: 'AND' | 'OR' | 'NOT'; children: RuleIR[] }
  | { type: 'RAW'; client?: Client; text: string }
) & { extendedMatching?: boolean }; // Surge 扩展匹配必须保留；其他客户端不能静默移除

export type ClientOverride = {
  when: { client: Client; platform?: Platform };
  action: { replace: RuleIR[] } | { drop: true } | { append: RuleIR[] };
};

export type RuleSetFormat = 'auto' | 'classical' | 'domain' | 'ipcidr' | 'domain-set' | 'yaml' | 'mrs' | 'srs';

/** 规则集的一个来源：远程地址或本地手写规则。 */
export type RuleSetSource = {
  /** 规则集内唯一；远程快照以 (规则集 id, URL) 定位，与来源 id 无关 */
  id: ID;
  kind: 'remote' | 'local';
  /** 仓库关联：地址由索引中的文件定位决定，不允许改为自定义地址。 */
  repository?: { repo: string; entry: string; ref: string; path: string };
  /** 显示名，缺省用 URL 或「本地规则」 */
  name?: string;
  url?: string;
  content?: string;
  /** 自动识别内容；历史值仅兼容域名方言与二进制来源。 */
  format: RuleSetFormat;
  /** 透传的二进制规则集（mrs）必须声明 behavior，其余格式解析后自动拆分 */
  behavior?: 'domain' | 'ipcidr' | 'classical';
  /** 仅兼容旧数据；新改写统一存放在 RuleSet.overrides，按规则内容定位 */
  overrides?: { line?: number; match?: string; override: ClientOverride }[];
  /** @deprecated 仅兼容旧输入；保存或迁移时移除停用来源并清除此字段。 */
  enabled?: boolean;
};

/**
 * 规则集：一个或多个来源（远程 URL / 本地规则）合并成一项，只配一个出口。
 * 单一兼容远程来源可透传；需要处理时合并去重后输出 classical LIST（原「规则包」并入规则集，2026-10-29）。
 */
export type RuleSet = {
  id: ID;
  name: string;
  /** 管理备注，仅用于界面展示 */
  note?: string;
  sources: RuleSetSource[];
  /** 替换、丢弃按原文匹配且首条命中生效；追加无需 match，按条件向整组加入规则 */
  overrides?: { match?: string; override: ClientOverride }[];
  /** @deprecated 仅兼容旧输入，忽略此字段；以来源内容中的 no-resolve 为准。 */
  noResolve?: boolean;
};

export type Matcher =
  | { kind: 'rule'; rule: RuleIR; overrides?: ClientOverride[] }
  | { kind: 'local'; content: string; client?: Client; overrides?: ClientOverride[] }
  | { kind: 'ruleset'; id: ID; repository?: RepositoryRuleSetReference; remote?: { url: string } };

/** 仓库规则直接引用：保存所选文件映射，内容仍按快照策略刷新，不创建本地规则集。 */
export type RepositoryRuleSetReference = {
  repo: string;
  entry: string;
  name: string;
  sources: RuleSetSource[];
};

// ---------- 分流 ----------

export type GroupMember =
  | { kind: 'builtin'; name: Builtin }
  | { kind: 'group'; groupId: ID }
  | { kind: 'nodeset'; ref: NodeSetID }
  | { kind: 'node'; ref: NodeRef }
  | { kind: 'all'; scope: 'all' | 'proxies' | 'providers' };

export type GroupType = 'select' | 'url-test' | 'fallback' | 'load-balance';

export type GroupSpec = {
  id: ID;
  name: string;
  type: GroupType;
  members: GroupMember[];
  filter?: string;
  excludeFilter?: string;
  excludeType?: string;
  test?: {
    url?: string;
    interval?: number;
    timeout?: number;
    tolerance?: number;
    /** Loon 的节点可用性阈值，毫秒；不同于单次请求超时。 */
    maxTimeout?: number;
    lazy?: boolean;
    maxFailedTimes?: number;
    expectedStatus?: string;
  };
  strategy?: 'consistent-hashing' | 'round-robin' | 'sticky-sessions';
  display?: { hidden?: boolean; icon?: string };
  extra?: Record<string, unknown>;
  hint?: string;
  /** @deprecated 仅兼容历史数据，渲染时忽略；空组一律 REJECT。 */
  whenEmpty?: 'reject' | 'direct';
};

export type RuleEntry = {
  id: ID;
  matcher: Matcher;
  target: Target;
  /** YAML 来源名称；仅用于模板往返，实际规则身份仍由 matcher 决定。 */
  providerName?: string;
  options?: {
    /** @deprecated 忽略此字段；no-resolve 仅从规则原文读取。 */
    noResolve?: boolean;
    src?: boolean;
  };
  /** @deprecated 仅兼容旧输入；规则以存在与否决定生效。 */
  enabled?: boolean;
};

export type Template = {
  id: ID;
  /** 仅兼容旧数据导入；当前模板不维护版本号。 */
  version?: number;
  changelog?: string;
  groups: GroupSpec[];
  rules: RuleEntry[];
  final: Target;
  /** 按导入顺序保存远程来源，包括尚未被规则引用的定义；不自动生成规则。 */
  ruleProviders?: { name: string; url: string }[];
};

// ---------- 订阅 ----------

/** @deprecated 仅兼容旧配置；引用方式由目标客户端自动决定。 */
export type RefStrategy = 'wrap' | 'copy' | 'inline';

export type Overlay = {
  groupPatches?: Record<ID, {
    addMembers?: GroupMember[];
    memberOrder?: 'append' | 'prepend';
    set?: Partial<Omit<GroupSpec, 'id' | 'members'>>;
  }>;
  extraGroups?: { after?: ID; group: GroupSpec }[];
  rulePatches?: Record<ID, { enabled?: boolean; target?: Target }>;
  extraRules?: { anchor: { before: ID } | { after: ID } | 'top' | 'bottom'; rule: RuleEntry }[];
  final?: Target;
};

/** 代理链的全部来源按订阅当前输出类型动态展开，不保存某次预览的节点快照。 */
export type ChainNodeSet = NodeSetID | { type: 'all'; id: 'provider' | 'inline' };
export type ChainNodeRef = Omit<NodeRef, 'nodeSet'> & { nodeSet: ChainNodeSet };
export type ChainTarget = Exclude<Target, { kind: 'node' }> | { kind: 'node'; ref: ChainNodeRef };

export type ChainRule = {
  id: ID;
  landing: { nodeSet: ChainNodeSet; filter?: string; excludeFilter?: string };
  via: ChainTarget;
};

export type ProfileNodeSet = { ref: NodeSetID; output: 'provider' | 'inline'; providerName?: string };

export type RoutingConfig = Pick<Template, 'groups' | 'rules' | 'final'>;
export type ProfileRouting =
  | {
    mode: 'bound'; templateId: ID; groupAdditions: Record<ID, GroupMember[]>;
    /** 按显示顺序优先于全部模板规则，仅允许本地单条或多条规则。 */
    prependRules?: RuleEntry[];
    /** 本订阅独立维护的策略组，追加于模板组末尾。 */
    extraGroups?: GroupSpec[];
  }
  | { mode: 'independent'; config: RoutingConfig; initializedFrom?: { templateId: ID; version?: number; name?: string } };

export type Profile = {
  /** 旧文档兼容读取；新订阅以 routing 为唯一分流配置来源。 */
  routing?: ProfileRouting;
  id: ID;
  name: string;
  nodeSets: ProfileNodeSet[];
  overlay: Overlay;
  chains: ChainRule[];
  /** @deprecated 兼容旧字段，渲染不再读取手动引用策略。 */
  refPolicy: { default: RefStrategy; perRef?: Record<string, RefStrategy> };
};
