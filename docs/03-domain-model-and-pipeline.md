# 03 · 领域模型与渲染流水线

本篇描述"怎么做"层面的关键设计，是 PRD 中 G1–G5 的落地方式。类型以 TypeScript 伪代码表示，与最终实现语言无关。

## 1. 设计原则

1. **只存"意图"，不存"结果"**：数据库保存的是源配置、处理链、模板、覆盖层、引用；节点列表与最终配置都是渲染产物（可缓存，随时可丢弃重建）。
2. **渲染 = 纯函数**：`render(profileSpec, snapshots, client) → { config, report }`。相同输入必然相同输出，便于缓存、测试、diff。
3. **引用用稳定 ID / 匹配表达式**，不用名称快照。
4. **客户端差异只在最后一步（Lowering）处理**，中间全部是客户端无关的 IR。

## 2. 领域模型

```ts
// ---------- 节点侧 ----------
type Source = {
  id: ID; owner: UserID; name: string;
  kind: 'remote' | 'local';
  urls?: string[];               // remote：可多个，按序合并
  content?: string;              // local
  fetch?: { ua?: string; timeoutMs?: number; ttlSec?: number; viaProxy?: string };
  pipeline: OperatorRef[];       // 处理链
};

type Snapshot = {                // 原始快照，仅存原文与元数据
  sourceId: ID; url: string; fetchedAt: Time; hash: string;
  body: string; userinfo?: TrafficInfo; ok: boolean; error?: string;
};

type Collection = {
  id: ID; name: string;
  members: { ref: NodeSetID; prefix?: string; suffix?: string }[];  // 有序，DAG
  pipeline: OperatorRef[];
};

type LocalProxyGroup = { id: ID; name: string; proxies: ProxyIR[] };

type NodeSetID = { type: 'source' | 'collection' | 'local'; id: ID };

type Operator =
  | { op: 'filter.regex'; patterns: string[]; keep: boolean }
  | { op: 'filter.type'; types: string[]; keep: boolean }
  | { op: 'filter.useless' }
  | { op: 'rename.regex'; rules: { pattern: string; flags?: string; replace: string }[] } // 正则链
  | { op: 'rename.delete'; patterns: string[] }
  | { op: 'flag'; mode: 'add' | 'remove' }
  | { op: 'sort.name'; order: 'asc' | 'desc' }
  | { op: 'sort.regex'; patterns: string[] }
  | { op: 'dedupe'; strategy: 'suffix' | 'drop'; template?: string }
  | { op: 'set'; fields: Partial<ProxyIR> }          // udp / tfo / skip-cert-verify ...
  | { op: 'script'; code: string };                  // 沙箱
type OperatorRef = { enabled: boolean } & (Operator | { op: 'fragment'; fragmentId: ID });

type ProxyIR = {                  // 客户端无关的节点表示（字段对齐 mihomo）
  name: string; type: string; server: string; port: number; [k: string]: unknown;
  dialer?: Target;                // 前置（渲染时转为 dialer-proxy / underlying-proxy）
  _source: NodeSetID; _origName: string; _key: string;   // 隐式字段，输出时剥离
};

// ---------- 引用 ----------
type NodeRef = {
  nodeSet: NodeSetID;
  match: { exact: string } | { regex: string };   // 解析时取第一个命中
  fallback?: Target | 'error';
};
type Builtin = 'DIRECT' | 'REJECT' | 'REJECT-DROP' | 'PASS';
type Target =
  | { kind: 'builtin'; name: Builtin }
  | { kind: 'group'; groupId: ID }               // 模板组或 Profile 私有组
  | { kind: 'node'; ref: NodeRef };              // 仅 Profile 层允许

// ---------- 规则侧 ----------
type RuleIR =
  | { type: 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'DOMAIN-WILDCARD' | 'DOMAIN-REGEX'; value: string }
  | { type: 'IP-CIDR' | 'IP-CIDR6' | 'IP-ASN' | 'SRC-IP-CIDR'; value: string; noResolve?: boolean }
  | { type: 'GEOSITE' | 'GEOIP'; value: string; noResolve?: boolean }
  | { type: 'DST-PORT' | 'SRC-PORT'; value: string }
  | { type: 'NETWORK'; value: 'tcp' | 'udp' }
  | { type: 'PROCESS'; kind: 'name' | 'path'; mode: 'exact' | 'wildcard' | 'regex'; value: string } // 语义化
  | { type: 'AND' | 'OR' | 'NOT'; children: RuleIR[] }
  | { type: 'RAW'; client: Client; text: string };   // 逃生通道：只对指定客户端原样输出

type ClientOverride = {
  when: { client: Client; platform?: Platform };
  action: { replace: RuleIR[] } | { drop: true };
};

type RuleSet = {
  id: ID; name: string;
  kind: 'remote' | 'local';
  url?: string; content?: string; format: 'auto' | 'classical' | 'domain' | 'ipcidr' | 'domain-set' | 'yaml' | 'mrs' | 'srs';
  overrides?: { line?: number; match?: string; override: ClientOverride }[];
  script?: string;               // (rule, ctx) => rule | rule[] | null
};

type RuleBundle = {              // 最多两层：items 内不得出现 bundle
  id: ID; name: string;
  items: ({ kind: 'ruleset'; id: ID } | { kind: 'rule'; rule: RuleIR })[];
  noResolve?: boolean;
};

type Matcher =
  | { kind: 'rule'; rule: RuleIR; overrides?: ClientOverride[] }
  | { kind: 'ruleset'; id: ID }
  | { kind: 'bundle'; id: ID };

// ---------- 分流 ----------
type GroupMember =
  | { kind: 'builtin'; name: Builtin }
  | { kind: 'group'; groupId: ID }
  | { kind: 'nodeset'; ref: NodeSetID }        // Profile 层
  | { kind: 'node'; ref: NodeRef }             // Profile 层
  | { kind: 'all'; scope: 'all' | 'proxies' | 'providers' };   // Profile 层

type GroupSpec = {
  id: ID; name: string;
  type: 'select' | 'url-test' | 'fallback' | 'load-balance';
  members: GroupMember[];
  filter?: string; excludeFilter?: string; excludeType?: string;
  test?: { url?: string; interval?: number; timeout?: number; tolerance?: number; lazy?: boolean;
           maxFailedTimes?: number; expectedStatus?: string };
  strategy?: 'consistent-hashing' | 'round-robin' | 'sticky-sessions';
  display?: { hidden?: boolean; icon?: string };
  extra?: Record<string, unknown>;             // 高级参数，带客户端适用范围
  hint?: string;                               // 模板填充提示
};

type RuleEntry = { id: ID; matcher: Matcher; target: Target; options?: { noResolve?: boolean; src?: boolean }; enabled: boolean };

type Template = {
  id: ID; version: number; changelog: string;
  groups: GroupSpec[];      // members 仅允许 builtin / group
  rules: RuleEntry[];       // target 仅允许 builtin / group
  final: Target;            // MATCH 出口
};

// ---------- 订阅 ----------
type Profile = {
  id: ID; owner: UserID; name: string;
  base?: { presetId?: ID; patch?: BasePatch };
  nodeSets: { ref: NodeSetID; output: 'provider' | 'inline'; providerName?: string }[];
  template?: { id: ID; follow: 'latest' | { pinned: number } };
  overlay: Overlay;
  chains: ChainRule[];
  refPolicy: { default: 'wrap' | 'copy' | 'inline'; perRef?: Record<RefKey, 'wrap' | 'copy' | 'inline'> };
  tokens: { token: string; label: string }[];
};

type Overlay = {
  groupPatches: Record<GroupID, { addMembers?: GroupMember[]; memberOrder?: 'append' | 'prepend'; set?: Partial<GroupSpec> }>;
  extraGroups: GroupSpec[];                                  // 私有组，插入位置用 after: GroupID
  rulePatches: Record<RuleID, { enabled?: boolean; target?: Target }>;   // target 可改为 node
  extraRules: { anchor: { before: RuleID } | { after: RuleID } | 'top' | 'bottom'; rule: RuleEntry }[];
  final?: Target;
};

type ChainRule = {
  id: ID;
  landing: { nodeSet: NodeSetID; filter?: string; excludeFilter?: string };
  via: Target;                                               // 前置：节点引用或组
};
```

## 3. 渲染流水线

```
            ┌────────────── 输入（全部按 ID/版本/哈希寻址）──────────────┐
            │ Profile · Template@v · BasePreset@v · Snapshots · RuleSets │
            └──────────────────────────────┬─────────────────────────────┘
 ① Resolve NodeSets     各 NodeSet：解析快照 → ProxyIR[] → 跑处理链（含 Collection 递归）
 ② Merge Template       Template@v ⊕ Overlay → 有效 groups / rules / final（见 §5）
 ③ Resolve Refs         收集所有 NodeRef / ChainRule / 上游自带 dialer → 依赖解析（见 §4）
 ④ Expand Rules         RuleSet/Bundle → RuleIR[]（读取规则快照，应用 overrides/script）
 ⑤ Validate (IR)        环检测、悬挂引用、名称唯一、空组
 ⑥ Lower(client, plat)  IR → mihomo YAML / Surge INI（见 04）
 ⑦ Verify               mihomo -t（可选）/ 静态校验
            └──────────→ { config, providers[], rulesets[], report }
```

- ①④ 的结果按 `(nodeSet, pipelineHash, snapshotHash)` 缓存；②③⑥ 很便宜，每次请求重算即可。
- `report` 记录：降级项、丢弃项、解析失败节点、孤儿覆盖项、引用兜底触发、校验结果。UI 预览与订阅访问日志共用。

### 3.1 服务端对外地址

| 地址 | 用途 |
| --- | --- |
| `GET /sub/:token` | Profile 主配置（UA 识别客户端） |
| `GET /p/:token/:nodeSetKey` | **Profile 专属** provider 内容：NodeSet 处理结果 + 本 Profile 链规则注入的 `dialer-proxy`（REF-06） |
| `GET /r/:token/:rulesetKey?behavior=domain\|ipcidr\|classical&format=yaml\|text` | 转换后的规则集 / 规则包拆分结果 |

provider 必须是 **Profile 专属**的，因为注入的 `dialer-proxy` 指向的是该 Profile 内的组名。

## 4. 依赖解析：代理链与规则引用 provider 节点

### 4.1 约束回顾（mihomo）

- `dialer-proxy` / rule 出口 / 组成员 `proxies` 只能写**本地**节点名、组名或内置策略。
- provider 中的节点可通过 `override.dialer-proxy` 或自身字段 `dialer-proxy` 引用**本地**组/节点。
- 组可以 `use: [provider]` + `filter` 选出 provider 中的特定节点。

### 4.2 算法

```
输入：有效 groups、rules、chains、各 NodeSet 输出方式、refPolicy
1. 收集引用点 R：
   - 组成员中的 {kind:'node'}
   - 规则 / final 的 target {kind:'node'}
   - ChainRule.via 为 node 时
   - 任意节点的 dialer（本地节点设置的前置、上游订阅自带的 dialer-proxy）
2. 对每个引用 r 解析出具体节点 n（按 NodeRef.match 在 NodeSet 处理结果中查找）：
   - 找不到 → 走 fallback；无 fallback → report.error
3. 若 n 所在 NodeSet 输出方式为 inline → 直接用 n.name，结束
4. 否则（n 在 provider P 中）按策略：
   wrap  → 生成/复用组 G = { name: "__ref:<P>:<hash(n._key)>", type: select,
                            use: [P], filter: "^" + regexEscape(n.name) + "$", hidden: true }
           r 指向 G.name
   copy  → 在 proxies 中加入 n 的副本，名称 = n.name（冲突则 n.name + " ·local"）
           r 指向副本名
   inline→ 将 P 整体切换为 inline，重跑一次本步骤
5. ChainRule 的落地侧：
   - 落地 NodeSet 为 inline → 直接给匹配节点写 dialer-proxy
   - 落地 NodeSet 为 provider →
       a. 若 filter 为空（整源都走同一前置）→ 输出 proxy-providers.P.override.dialer-proxy
       b. 否则 → 在 /p/:token/P 的内容中只给匹配节点注入 dialer-proxy
6. 上游自带 dialer-proxy 的节点（REF-04）：
   - 其前置名在同一 NodeSet 中 → 视为 NodeRef(同 NodeSet, exact) 走步骤 3–4
   - 在其他地方找不到 → report.warn，并按 fallback 处理（默认移除该字段）
7. 环检测：在“节点→前置”图上做 DFS，成环则报错
```

要点：

- **包装组的 filter 必须精确匹配**：对名称做正则转义并加 `^…$`；若同一 provider 存在同名（理论上被 SRC-11 杜绝），报错。
- 包装组名对用户不可见（`hidden: true`），面板中仍按 provider 分组展示，满足"不打平、按源看面板"。
- 包装组是 select 且只有一个成员，行为与直接引用节点一致；provider 更新后 filter 重新命中，**无需重新下发主配置**（只要名称不变；名称变化本身意味着处理链输出变化，主配置会在下次拉取时更新）。

### 4.3 Surge 的对应处理

Surge 的外部节点通过组的 `policy-path` 引入，同样不能被 `underlying-proxy` 或规则直接按名引用（**待核对 Surge 手册**）。对应方案：

- wrap → 生成 `__ref_xxx = select, policy-path=<provider 地址>, policy-regex-filter=^name$, hidden=true`
- copy → 节点写入 `[Proxy]`
- 落地侧链注入：在 Profile 专属的 policy-path 内容中给节点附加 `underlying-proxy=<前置名>`

若核对后发现 Surge 支持更直接的写法，以 Lowering 层替换实现，IR 与 UI 不变。

## 5. 模板 ⊕ 覆盖层 合并

```
effective.groups = template.groups 按序
  对每个组 g：
    p = overlay.groupPatches[g.id]
    g.members = (p.memberOrder == 'prepend') ? p.addMembers ++ g.members : g.members ++ p.addMembers
    g = { ...g, ...p.set }                 // 不允许改 id；允许改 name、type、测速参数
  按 after 锚点插入 overlay.extraGroups
effective.rules = template.rules 按序
  对每条 r：应用 rulePatches[r.id]（enabled / target）
  按锚点插入 overlay.extraRules
effective.final = overlay.final ?? template.final

孤儿：groupPatches / rulePatches / 锚点 中引用的 ID 在 template@v 不存在 → 不应用，记入 report.orphans
```

- 模板只存 `version`；Profile `follow: 'latest'` 时每次渲染读取最新版本，从而**模板更新自动同步**。
- 规则出口改为节点（`rulePatches.target = {kind:'node'}`）只在覆盖层中允许，满足"模板中不可关联节点"。
- 空组处理：模板组在 Profile 中未被填充任何成员时，按待决问题 Q3 的结论输出（建议：自动填充 `DIRECT` 并告警，避免 mihomo 因空组报错）。

## 6. 规则展开与规则包拆分

```
expand(bundle):
  rules = concat(items.map(i => i.kind == 'ruleset' ? load(i.id).rules : [i.rule]))
  去重（按 type+value）
  按 behavior 分桶：
    domain   : DOMAIN / DOMAIN-SUFFIX（可转为 mihomo domain behavior: +.suffix）
    ipcidr   : IP-CIDR / IP-CIDR6
    classical: 其余（KEYWORD、REGEX、PROCESS、GEOIP、AND/OR…）
  输出顺序：domain → classical(非 IP 类) → ipcidr（IP 类统一 no-resolve 可选）
```

同一出口的规则在包内部的相对顺序不影响命中结果，唯一需要关心的是 IP 类规则会触发 DNS 解析，因此放在最后。

## 7. 缓存与刷新

| 层 | 键 | 失效 |
| --- | --- | --- |
| 原始快照 | sourceId + url | TTL 到期 / 手动刷新；拉取失败保留旧快照 |
| NodeSet 结果 | nodeSetId + pipelineHash + 成员快照哈希 | 任一变化 |
| 规则集展开 | rulesetId + snapshotHash + overridesHash + client/platform | 任一变化 |
| 渲染结果 | profileId + templateVersion + presetVersion + 上述哈希 + client/platform | 任一变化 |

客户端每次拉取订阅时：快照未过期则直接用缓存渲染；过期则后台刷新、本次先返回旧结果（stale-while-revalidate），避免订阅请求超时。
