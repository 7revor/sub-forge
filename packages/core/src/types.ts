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
  /** 前置：渲染时转为 dialer-proxy / underlying-proxy */
  dialer?: Target;
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
  | { op: 'set'; fields: Record<string, unknown> }
  | { op: 'script'; code: string };

export type OperatorStep = Operator & { enabled?: boolean };

export type Source = {
  id: ID;
  name: string;
  kind: 'remote' | 'local';
  urls?: string[];
  content?: string;
  pipeline: OperatorStep[];
};

export type Collection = {
  id: ID;
  name: string;
  /** onFail：成员拉取失败时的处理（使用快照 / 跳过该成员 / 整体失败）；界面已提供，渲染尚未读取，见 docs/11 */
  members: { ref: NodeSetID; prefix?: string; suffix?: string; onFail?: 'snapshot' | 'skip' | 'fail' }[];
  pipeline: OperatorStep[];
};

export type LocalProxyGroup = {
  id: ID;
  name: string;
  /** 用户手写的节点（不含隐式字段，解析时补上） */
  proxies: LocalProxy[];
};

export type LocalProxy = {
  name: string;
  type: string;
  server: string;
  port: number;
  /** 前置（LOC-02） */
  dialer?: Target;
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

export type Client = 'mihomo' | 'surge';
export type Platform = 'android' | 'macos' | 'windows' | 'ios' | 'linux';

export type DomainRuleType = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'DOMAIN-WILDCARD' | 'DOMAIN-REGEX';
export type IpRuleType = 'IP-CIDR' | 'IP-CIDR6' | 'IP-ASN' | 'SRC-IP-CIDR';

export type RuleIR =
  | { type: DomainRuleType; value: string }
  | { type: IpRuleType; value: string; noResolve?: boolean; src?: boolean }
  | { type: 'GEOSITE'; value: string }
  | { type: 'GEOIP'; value: string; noResolve?: boolean; src?: boolean }
  | { type: 'DST-PORT' | 'SRC-PORT'; value: string }
  | { type: 'NETWORK'; value: 'tcp' | 'udp' }
  | { type: 'PROCESS'; kind: 'name' | 'path'; mode: 'exact' | 'wildcard' | 'regex'; value: string }
  | { type: 'AND' | 'OR' | 'NOT'; children: RuleIR[] }
  | { type: 'RAW'; client: Client; text: string };

export type ClientOverride = {
  when: { client: Client; platform?: Platform };
  action: { replace: RuleIR[] } | { drop: true };
};

export type RuleSetFormat = 'auto' | 'classical' | 'domain' | 'ipcidr' | 'domain-set' | 'yaml' | 'mrs' | 'srs';

export type RuleSet = {
  id: ID;
  name: string;
  kind: 'remote' | 'local';
  url?: string;
  content?: string;
  format: RuleSetFormat;
  /** 透传的二进制规则集（mrs）必须声明 behavior，其余格式解析后自动拆分 */
  behavior?: 'domain' | 'ipcidr' | 'classical';
  /** 行级客户端覆盖：按解析后的行号（从 1 开始）或原文精确匹配定位 */
  overrides?: { line?: number; match?: string; override: ClientOverride }[];
};

export type RuleBundle = {
  id: ID;
  name: string;
  items: ({ kind: 'ruleset'; id: ID; enabled?: boolean } | { kind: 'rule'; rule: RuleIR; enabled?: boolean })[];
  noResolve?: boolean;
};

export type Matcher =
  | { kind: 'rule'; rule: RuleIR; overrides?: ClientOverride[] }
  | { kind: 'ruleset'; id: ID }
  | { kind: 'bundle'; id: ID };

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
    lazy?: boolean;
    maxFailedTimes?: number;
    expectedStatus?: string;
  };
  strategy?: 'consistent-hashing' | 'round-robin' | 'sticky-sessions';
  display?: { hidden?: boolean; icon?: string };
  extra?: Record<string, unknown>;
  hint?: string;
  /** 模板组为空时的行为，默认 reject（TPL-10） */
  whenEmpty?: 'reject' | 'direct';
};

export type RuleEntry = {
  id: ID;
  matcher: Matcher;
  target: Target;
  options?: { noResolve?: boolean; src?: boolean };
  enabled?: boolean;
};

export type Template = {
  id: ID;
  version: number;
  changelog?: string;
  groups: GroupSpec[];
  rules: RuleEntry[];
  final: Target;
};

// ---------- 订阅 ----------

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

export type ChainRule = {
  id: ID;
  landing: { nodeSet: NodeSetID; filter?: string; excludeFilter?: string };
  via: Target;
};

export type ProfileNodeSet = { ref: NodeSetID; output: 'provider' | 'inline'; providerName?: string };

export type Profile = {
  id: ID;
  name: string;
  nodeSets: ProfileNodeSet[];
  overlay: Overlay;
  chains: ChainRule[];
  refPolicy: { default: RefStrategy; perRef?: Record<string, RefStrategy> };
};
