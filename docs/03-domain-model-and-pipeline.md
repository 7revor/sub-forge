# 03 · 领域模型与渲染流水线

本篇描述"怎么做"层面的关键设计，是 PRD 中 G1–G5 的落地方式。类型以 TypeScript 伪代码表示，与最终实现语言无关。

## 1. 设计原则

1. **只存"意图"，不存"结果"**：数据库保存的是源配置、处理链、模板、覆盖层、引用；节点列表与最终配置都是渲染产物（可缓存，随时可丢弃重建）。
2. **渲染 = 纯函数**：`render(profileSpec, snapshots, client) → { config, report }`。相同输入必然相同输出，便于缓存、测试、diff。
3. **引用用稳定 ID / 匹配表达式**，不用名称快照。
4. **客户端差异只在最后一步（Lowering）处理**，中间全部是客户端无关的 IR。

## 2. 领域模型

订阅源从 2026-10-29 起只保存单个 `url`。接口和种子兼容旧版只含一个元素的 `urls`，统一转换为 `url`；多地址、空地址或同时提供两种字段均拒绝。数据库 v9 在事务内转换旧单地址文档，保留 ID、归属、更新时间、引用与快照；遇到意外多地址会回滚，不能自动截断。

```ts
// ---------- 节点侧 ----------
type Source = {
  id: ID; owner: UserID; name: string;
  url: string;                   // 一个 HTTP(S) URL；多个来源用 Collection，粘贴节点用 LocalProxyGroup
  fetch?: { ttlSec?: number }; // 自动更新间隔；UA 固定 clash.meta，超时固定 10 秒
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
  upstreamDialer?: string;        // 上游订阅自带的 dialer-proxy / underlying-proxy 原文（REF-04）
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
  | { type: 'USER-AGENT'; value: string }       // Surge 专用；mihomo 输出为客户端不支持注释
  | { type: 'NETWORK'; value: 'tcp' | 'udp' }
  | { type: 'PROCESS'; kind: 'name' | 'path'; mode: 'exact' | 'wildcard' | 'regex'; value: string } // 语义化
  | { type: 'AND' | 'OR' | 'NOT'; children: RuleIR[] }
  | { type: 'RAW'; client?: Client; text: string };  // 单条原文；未指定客户端时按目标客户端原样输出，旧 client 限制继续生效

type ClientOverride = {
  when: { client: Client; platform?: Platform };
  action: { replace: RuleIR[] } | { drop: true };
};

// 规则集由多个来源合并（2026-10-29 起；原 RuleBundle 并入规则集，旧数据迁移为同 id 的规则集）
type RuleSetSource = {
  id: ID;                        // 规则集内唯一；远程快照按 (规则集 id, URL) 定位
  kind: 'remote' | 'local';
  name?: string;                 // 缺省显示 URL 或「本地规则」
  url?: string; content?: string; format: 'auto' | 'classical' | 'domain' | 'ipcidr' | 'domain-set' | 'yaml' | 'mrs' | 'srs';
  behavior?: 'domain' | 'ipcidr' | 'classical';   // mrs 透传必须声明
  overrides?: { line?: number; match?: string; override: ClientOverride }[];  // 仅用于尚无法转换的旧配置兼容，不用于新建改写
  enabled?: boolean;
  fetch?: FetchOptions;          // 服务层：远程来源的拉取参数
};

type RuleSet = {
  id: ID; name: string;
  sources: RuleSetSource[];      // 按序合并、去重
  overrides?: { match: string; override: ClientOverride }[]; // 整组按规则原文精确匹配，第一条客户端/平台匹配项生效
  noResolve?: boolean;           // 仅兼容旧输入，忽略；以来源原文为准
  script?: string;               // (rule, ctx) => rule | rule[] | null（P1）
};

type Matcher =
  | { kind: 'rule'; rule: RuleIR; overrides?: ClientOverride[] }
  | { kind: 'ruleset'; id: ID };

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
  filter?: string; excludeFilter?: string; excludeType?: string;   // 模板可预设，Profile 可覆盖；仅筛选节点集成员
  test?: { url?: string; interval?: number; timeout?: number; tolerance?: number; lazy?: boolean;
           maxFailedTimes?: number; expectedStatus?: string };
  strategy?: 'consistent-hashing' | 'round-robin' | 'sticky-sessions';
  display?: { hidden?: boolean; icon?: string };
  extra?: Record<string, unknown>;             // 高级参数，带客户端适用范围
  hint?: string;                               // 模板填充提示
  whenEmpty?: 'reject' | 'direct';             // 废弃，仅兼容历史存储；渲染忽略，空组固定 REJECT
};

type RuleEntry = { id: ID; matcher: Matcher; target: Target; options?: { noResolve?: boolean; src?: boolean }; enabled: boolean };

type Template = {
  id: ID; version: number; changelog: string;
  groups: GroupSpec[];      // members 仅允许 builtin / group；不得设置 filter 类字段
  rules: RuleEntry[];       // target 仅允许 builtin / group
  final: Target;            // MATCH 出口
};

// ---------- 订阅（历史模型；2026-10-29 起采用文末 routing 两种模式） ----------
type Profile = {
  id: ID; owner: UserID; name: string;
  base?: { presetId?: ID; patch?: BasePatch };
  nodeSets: { ref: NodeSetID; output: 'provider' | 'inline'; providerName?: string }[];
  template?: { id: ID; follow: 'latest' | { pinned: number } };
  overlay: Overlay;
  chains: ChainRule[];
  // 2026-10-30 起仅兼容旧数据；渲染忽略，保存规范化为 { default: 'wrap' }。
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

`{ op: 'flag', mode: 'add' }` 根据节点名称中的地区名或代码添加旗帜；已带旗帜的名称保持不变。以 Traffic、Expire、Remaining 等或流量、到期等开头的说明节点跳过识别，避免把流量单位 GB 当作英国代码。需要移除这类伪节点时，另用 `filter.useless`。

## 3. 渲染流水线

```
            ┌────────────── 输入（全部按 ID/版本/哈希寻址）──────────────┐
            │ Profile · Template@v · BasePreset@v · Snapshots · RuleSets │
            └──────────────────────────────┬─────────────────────────────┘
 ① Resolve NodeSets     各 NodeSet：解析快照 → ProxyIR[] → 跑处理链（含 Collection 递归）
 ② Merge Template       Template@v ⊕ Overlay → 有效 groups / rules / final（见 §5）
 ③ Resolve Refs         收集所有 NodeRef / ChainRule / 上游自带 dialer → 依赖解析（见 §4）
 ④ Expand Rules         RuleSet（逐个来源）→ RuleIR[]（读取规则快照，应用各来源的 overrides/script）
 ⑤ Validate (IR)        环检测、悬挂引用、名称唯一、空组
 ⑥ Lower(client, plat)  IR → mihomo YAML / Surge INI（见 04）
 ⑦ Verify               mihomo -t（可选）/ 静态校验
            └──────────→ { config, providers[], rulesets[], report }
```

- ①④ 的结果按 `(nodeSet, pipelineHash, snapshotHash)` 缓存；②③⑥ 很便宜，每次请求重算即可。
- `report` 记录：降级项、丢弃项、解析失败节点、孤儿覆盖项、引用兜底触发、校验结果。UI 预览与订阅访问日志共用。
- 节点 YAML 入口统一接受单节点映射、裸节点列表及带 `proxies` 的配置，转换为相同的 `ProxyIR[]`，不改变节点存储模型。语法损坏继续使订阅解析失败；本地原始配置的粘贴入口捕获并显示诊断，不覆盖当前草稿。粘贴仅允许单节点，客户端 JSON 由内核独立转换函数规范为 Mihomo 字段；不改变远程订阅解析策略、存储模型或保存接口。

### 3.1 服务端对外地址

| 地址 | 用途 |
| --- | --- |
| `GET /sub/:token` | Profile 主配置（UA 识别客户端） |
| `GET /p/:token/:nodeSetKey` | **Profile 专属** provider 内容：NodeSet 处理结果 + 本 Profile 链规则注入的 `dialer-proxy`（REF-06，仅 mihomo）；Surge 的 `policy-path` 也指向此地址，内容不注入前置 |
| `GET /r/:token/:rulesetKey?behavior=domain\|ipcidr\|classical&format=yaml\|text` | 转换后的规则集拆分结果（合并全部启用来源后按 behavior 拆分） |

provider 必须是 **Profile 专属**的，因为注入的 `dialer-proxy` 指向的是该 Profile 内的组名。

## 4. 依赖解析：代理链与规则引用 provider 节点

> 原理与场景分析见 [06 · 代理链专项调研](06-proxy-chain-research.md)。本节只描述算法。

### 4.1 约束回顾（mihomo）

- `dialer-proxy` / rule 出口 / 组成员 `proxies` 只能写**本地**节点名、组名或内置策略。
- provider 中的节点可通过 `override.dialer-proxy` 或自身字段 `dialer-proxy` 引用**本地**组/节点。
- 组可以 `use: [provider]` + `filter` 选出 provider 中的特定节点。

### 4.2 算法

```
输入：有效 groups、rules、chains、各 NodeSet 输出方式、目标客户端（旧 refPolicy 不参与计算）
1. 收集引用点 R：
   - 组成员中的 {kind:'node'}
   - 规则 / final 的 target {kind:'node'}
   - ChainRule.via 为 node 时
   - 上游订阅自带的 dialer-proxy（本地节点不设置前置，代理链只来自 Profile 的链规则）
2. 对每个引用 r 解析出具体节点 n（按 NodeRef.match 在 NodeSet 处理结果中查找）：
   - 找不到 → 走 fallback；无 fallback → report.error
3. 若 n 所在 NodeSet 输出方式为 inline → 直接用 n.name，结束
4. 否则（Mihomo 的 n 在 Provider P 中）自动处理：
            生成/复用组 G = { name: "__ref_<P>_<hash(n._key)>", type: select,
                            use: [P], filter: "^" + regexEscape(n.name) + "$",
                            hidden: true, empty-fallback: REJECT }   // 防止静默直连
           r 指向 G.name
   Stash 在节点集阶段已转换为内联，由步骤 3 直接引用。
5. ChainRule 的落地侧：
   - 落地 NodeSet 为 inline → 直接给匹配节点写 dialer-proxy
   - 落地 NodeSet 为 provider →
       在 /p/:token/P 的订阅专属内容中给匹配节点注入 dialer-proxy；整集规则覆盖局部规则。
6. 上游自带 dialer-proxy 的节点（REF-04）：
   - 其前置名在同一 NodeSet 中 → 视为 NodeRef(同 NodeSet, exact) 走步骤 3–4
   - 在其他地方找不到 → report.warn，并按 fallback 处理（默认移除该字段）
7. 环检测：在“节点→前置”图上做 DFS（包装组、provider 节点都计入），成环则报错
8. 引用校验：所有 dialer-proxy / 规则目标 / 组成员必须在顶层表中（mihomo 不校验 provider 内的 dialer-proxy）
9. Profile 专属 provider 的 URL 追加 ?v=<该 provider 注入内容的哈希>；proxy-providers 不输出 path（否则改 URL 不会触发重新下载，06 §3）
```

要点：

- **包装组的 filter 必须精确匹配**：对名称做正则转义并加 `^…$`；若同一 provider 存在同名（理论上被 SRC-11 杜绝），报错。
- 包装组名对用户不可见（`hidden: true`），面板中仍按 provider 分组展示，满足"不打平、按源看面板"。
- 包装组是 select 且只有一个成员，行为与直接引用节点一致；provider 更新后 filter 重新命中，**无需重新下发主配置**（只要名称不变；名称变化本身意味着处理链输出变化，主配置会在下次拉取时更新）。

### 4.3 Surge 的对应处理

原理见 [06 §5](06-proxy-chain-research.md#5-surge)。步骤 1–3、7、8 与 mihomo 相同，差异在步骤 4、5：

```
4'. n 在外部节点集 P（policy-path）中：
   wrap  → 生成包装组（D2 暂定写法）：
             __ref_<P>_<hash>_in = select, policy-path=<P 地址>, policy-regex-filter=^<转义名>$, hidden=true
             __ref_<P>_<hash>    = fallback, __ref_<P>_<hash>_in, REJECT, hidden=true
           r 指向 __ref_<P>_<hash>；report.info("Surge 防泄漏未验证")
   copy  → 节点写入 [Proxy]，r 指向副本名
   inline→ 将 P 整体切换为 inline，重跑本步骤
5'. ChainRule 的落地侧：
   - 落地 NodeSet 为 inline → 给匹配节点写 underlying-proxy=<前置名>
   - 落地 NodeSet 为 policy-path →
       客户端版本 ≥ iOS 5.22.0 / Mac 6.9.0：
         生成 __chain_<P>_<hash> = select, policy-path=<P 地址>,
               [policy-regex-filter=<落地 filter>], underlying-proxy=<前置名>, hidden=true
         原本引用 P 的组改为把 __chain_<P>_<hash> 作为嵌套成员；未被 filter 命中的节点仍走原组
       否则：不输出该链规则，report.warn("Surge 版本过低，外部节点集上的代理链不可用")
```

- Surge 的外部内容不需要注入前置，因此 `/p/:token/:key` 对 Surge 只输出处理链结果；
- 落地 `excludeFilter` 没有对应参数，转为负向前瞻合并进 `policy-regex-filter`，或服务端预过滤后用精确名称列表构造正则；
- 运行时待验证的点见 06 §5.3，验证结果若不同，只替换 Lowering 实现，IR 与 UI 不变。

## 5. 模板 ⊕ 覆盖层 合并

2026-10-29 界面调整只合并管理员的模板入口并统一空状态样式，不改变 `Template`、`Profile` 的字段或本节合并规则。普通用户仍在新建配置订阅时读取已发布模板。

```
effective.groups = template.groups 按序
  对每个组 g：
    p = overlay.groupPatches[g.id]
    g.members = (p.memberOrder == 'prepend') ? p.addMembers ++ g.members : g.members ++ p.addMembers
    g = { ...g, ...p.set }                 // 允许改 type、测速参数、高级参数；不允许改 id / name / hidden（Q6）
  按 after 锚点插入 overlay.extraGroups
effective.rules = template.rules 按序
  对每条 r：应用 rulePatches[r.id]（enabled / target）
  按锚点插入 overlay.extraRules
effective.final = overlay.final ?? template.final

孤儿：groupPatches / rulePatches / 锚点 中引用的 ID 在 template@v 不存在 → 不应用，记入 report.orphans
```

- 模板只存 `version`；Profile `follow: 'latest'` 时每次渲染读取最新版本，从而**模板更新自动同步**。
- 规则出口改为节点（`rulePatches.target = {kind:'node'}`）只在覆盖层中允许，满足"模板中不可关联节点"。
- 模板组不能在 Profile 中删除、改名或隐藏（Q6）；`groupPatches.set` 中出现 `name` / `display.hidden` 时校验报错。Profile 私有组（`extraGroups`）不受此限制。
- 空组处理（TPL-10，2026-10-29 修订）：模板和私有组统一拒绝。静态无成员或内联节点筛空时补 `proxies: [REJECT]`，记录 `group.empty` 告警；所有组固定输出 `empty-fallback: REJECT`，由 Mihomo v1.19.27+ 处理运行时 provider 未加载、更新或筛选后无成员的情况。覆盖层、旧 `whenEmpty: direct` 和 `extra.empty-fallback` 都不能改变此行为。节点测速失败仍按组类型处理，不等于空组。UI 不提供空组设置，Surge 输出仍未开放。

## 6. 规则集展开与输出

```
expand(ruleset):
  rules = concat(sources.filter(enabled).map(s => applyOverrides(parse(s.kind == 'local' ? s.content : snapshot(ruleset.id, s.url)), ruleset.overrides)))
  单一启用的远程来源且无额外处理、客户端支持原内容：原格式透传
  其他可解析来源：合并为一个 classical LIST；不再按桶创建多个 provider
  mrs / srs 无解码能力，需要处理或客户端不支持时明确失败
  去重（按 type+value）
  内部按 behavior 分类，仅用于排序与统计：
    domain   : DOMAIN / DOMAIN-SUFFIX（可转为 mihomo domain behavior: +.suffix）
    ipcidr   : IP-CIDR / IP-CIDR6
    classical: 其余（KEYWORD、REGEX、PROCESS、GEOIP、AND/OR…）
  输出顺序：domain → classical(非 IP 类) → ipcidr（IP 类逐行保留原文 no-resolve）
```

改写对各来源解析后的规则原文精确匹配（不含出口），在合并去重之前应用；单来源预览与合并、订阅输出共用同一逻辑。v8 迁移将启用来源的旧原文匹配直接提升，旧行号按本地内容或已有成功快照转成内容匹配；停用来源及无法定位的旧项保留，并在独立改写区块提示，补充内容并保存时重试转换。组级匹配优先于兼容旧项。

预览接口的 `source` 选择单个来源（包括停用来源的诊断）；省略时只合并启用来源。来源状态中的 `rejected` 保留完整计数，新增可选 `rejectedDetails: { line, text, reason }[]`，最多返回前 100 条，供来源徽标直接展示诊断。该字段只存在于预览响应，规则集持久化结构与种子格式不变。

同一出口的规则在规则集内部的相对顺序不影响命中结果，唯一需要关心的是 IP 类规则会触发 DNS 解析，因此放在最后。

## 7. 缓存与刷新

2026-10-30 起，管理员在系统中统一设置资源缓存时间（默认 24 小时，1–8760 整数小时）。旧 `fetch.ttlSec`、`Profile.updateIntervalSec` 在 SQLite v21 迁移、导入和保存时移除。系统值保存后立即影响下次到期判断，客户端需下次更新配置后取得新间隔。

| 层 | 保留策略 | 刷新机制 |
| --- | --- | --- |
| 节点与规则原文 | 相同权限范围、资源类型、URL 和读取参数共享一份最新成功内容，另存最新失败状态 | 后台每分钟检查，或到期读取时等待刷新；失败保留旧内容，下次尝试为最近尝试时间加系统周期 |
| 仓库目录索引 | 最近成功的完整索引 | 同系统周期；失败保留旧索引；手动更新绕过周期 |
| 仓库文本正文 | 与公开仓库规则引用共享成功快照，按需首次读取 | 同系统周期；手动刷新所选文件 |
| 解析结果 | 按正文哈希与解析参数复用 | 输入变化立即失效；不另设时间 |
| 最终配置 | 每次重新生成，不保留结果内存缓存 | 保留 last_good 和最多 32 个结构版本，用于失败兜底及旧客户端配套资源 |
| 管理端查询 | staleTime=0、gcTime=0、HTTP no-store | 挂载、聚焦、恢复网络、SSE 变更通知重读；断连显示提示，重连全量重读 |
| 草稿预览 | 不保留已完成请求的时间缓存 | 保留在途合并；实时更新不得覆盖未保存草稿 |

成功且内容相同也更新真实成功时间；失败不改写成功时间，界面显示失败原因、最后成功时间和下次自动尝试时间。从未成功的资源明确不可用，不用空内容冒充成功。手动刷新强制拉取，但共享正在执行的同身份请求；读取参数或权限不同的资源隔离。

节点刷新只刷新自身；组合递归刷新节点来源；规则刷新自身启用远程来源；订阅递归收集生效节点和规则依赖，去重刷新后生成已使用客户端目标及默认 Mihomo 配置。任务持久化进度和逐项结果，部分失败可继续使用旧内容；重启标记任务中断，刷新期间依赖变化提示重新刷新。

文本规则统一输出本服务托管的 classical LIST；符合条件的单一 MRS 来源校验后原字节托管，SRS 明确不支持。节点 provider、rule provider 的 interval 和主订阅更新提示均使用系统周期；用户必须在客户端更新才能获取新内容。

Git 缓存成功建立索引后更新保护引用并回收不可达旧对象；失败更新保留最后成功索引对应的提交。会话有效期（30 天）、访问日志保留（30 天）、刷新任务记录（7 天）、网络超时、在途任务和搜索防抖不是资源缓存时间，不参与合并。

### 2026-10-29：规则仓库首期接入

仓库索引独立于用户文档，SQLite v10 新增 `rule_repos`（启停、更新时间、各分支 commit、失败原因）与 `rule_repo_entries`（仓库、逻辑 key、归一化名称、文件变体）。索引不写入种子。

当前导入把选定文本变体的一个或多个文件转换为现有 `RuleSetSource { kind: 'remote', url, format, behavior }`。规则集所有权、改写、快照、合并与去重仍使用已有模型；本期没有增加 `kind: 'repo'`，没有动态客户端变体选择。完整目标见 [08](08-rule-repository-index.md)。

## 2026-10-29：自定义仓库索引配置

SQLite v11 的 `rule_repos.definition` 为可空 JSON：`id/name/owner/repo/refs/license/adapter=generic/options`，options 包含 directory、include、exclude、format；内置仓库保留空 definition。索引使用完整文件路径（含扩展名）作为 key，一个文件一个通用文本变体。添加先验证公开仓库与默认分支，再异步读取 commit/tree。详情按需解析并报告拒绝行，导入前校验有效内容及仓库启用状态。规则领域模型不变，导入仍写 remote，后续交给既有快照→解析→合并→改写→输出链；保留主分支新增的 repository 文件标识，但不动态切换变体。

### 2026-10-29：保留来源关联身份

`RuleSetSource` 新增可选 `repository: { repo, entry, ref, path }`，内部仍为 `kind: remote`，继续走既有快照与解析合并。URL 从索引文件推导，不按客户端动态切换变体；格式仍可配置，缓存周期由系统统一管理。新增关联校验启用仓库和索引文件，既有来源禁止修改 URL、移除或替换标识；允许删除来源后重新关联。仓库停用或上游删文件后，既有来源仍可保存其他设置。

服务初始化及索引更新后，旧来源仅在名称严格为 `仓库 ID · 文件路径` 且完整 URL 命中索引时补齐标识并持久化，保留归属。旧数据未记录导入来源，完全仿照旧命名的自定义来源无法区分；已改地址或不同名称的自定义来源保持原样。无须新增数据库表或版本。

### 2026-10-29：索引文件与输入格式分离

仓库候选扩展名固定为 list/txt，自定义路径通配符不能扩大范围。zydou 仅读取 surge-rule-set 与 surge-domain-set；blackmatrix7 不再索引 YAML。服务初始化过滤旧缓存中的不支持变体（多文件变体整体过滤），删除空条目，清空受影响仓库的 revisions 与 checked_at，从而在 commit 不变时也重新构建；既有 RuleSetSource 文档不改动。旧自定义仓库 `format: yaml` 改为 auto，保留用户路径筛选。

RuleSetSource.format 继续表示输入格式（yaml 与 auto 保留）。YAML 解析结果增加可选 `conversion: yaml-to-list`，预览来源状态透出同名字段，前端展示转换托管标记。输入先解析为 IR，应用改写，再分桶输出 LIST 文本；不是把 YAML URL 直接下发。保存/预览拒绝把 YAML 地址或同 URL 的既有 yaml 输入标记为 mrs/srs；内核也阻止已知 YAML 地址被透传。原生二进制透传不承担转换功能。

## 2026-10-29 追加：索引凭据

历史方案（已由 v14 移除）：SQLite schema v12 新增 `server_secrets(name,value)`；`github-index-token` 使用现有 Cipher 加密保存，与规则集、索引文件及用户订阅 Token 分离。管理员接口 `GET/PUT/DELETE /api/rule-repos/github-token` 仅返回 `{ configured: boolean }`，PUT 接受 `{ token: string }`。每次 GitHub API 请求读取最新凭据，不向 raw 文件请求或转换输出传播，跨源（包括 HTTP 降级）重定向后永久剥离认证头。种子导入不携带该服务凭据，示例种子保持不变。

## 2026-10-29 追加：按文件创建仓库关联

`GET /api/rule-repos/files?repo=…&path=…` 直接读取索引，按 `(ref,path)` 去重，返回文件、分支与上游链接，不拉取 README 或内容。`POST /api/rule-repos/import` 新增 `file: {ref,path}`，与 `variant` 互斥；验证文件属于当前启用仓库的文本索引并有可解析内容后，只创建一个关联来源，保留输入格式与分支。原推荐组合接口供既有调用兼容使用。核心 IR、已存规则集与种子无需迁移。

## 2026-10-29 追加：布局隔离

登录页不复用业务页面的 page-scroll 容器；通用 Modal 使用 Portal 挂载到 body，以避免页面限宽选择器和祖先裁切影响遮罩。纯前端修复，领域模型、后端接口与示例种子不变。

### 2026-10-29：输入格式自动识别与原格式透传

本节替代此前“YAML 只能托管”与“三类 provider 分桶输出”的约定。格式不再由用户选择；文本按内容自动识别，历史格式仅用于域名方言兼容。预览始终经过 IR 转换，并返回识别出的 format/behavior 与整组 delivery。

- 单个启用远程来源、无组级/来源级覆写、无 src 等处理或自定义 UA，且目标客户端支持内容语义时：引用原 URL，并按识别结果设置 format（text/yaml）与 behavior。
- 多来源、改写、IP 选项、未知行过滤或方言翻译等情况：一个 `.list`，`format: text`、`behavior: classical`；继续去重并保留行内 IP 选项。
- Surge DOMAIN-SET 的 `.域名` 包含根域；Clash/YAML domain 的前导点只含子域，转换不能扩大匹配范围。纯文本方言存在歧义时沿用既有领域约定，并参考仓库元数据。
- 旧 MRS/SRS 仅保留已有透传能力，不新增解码器；无法转换时报告错误，订阅服务沿用已有失败回退。

格式支持依据：[mihomo rule-providers](https://wiki.metacubex.one/en/config/rule-providers/)、[文件内容格式](https://wiki.metacubex.one/en/config/rule-providers/content/)。当前完整订阅下载实现为 mihomo；Surge 继续用于规则预览。

## 管理列表查询模型（2026-10-29）

列表分页不改变领域文档、种子格式或数据库结构。查询参数为 `page`、`pageSize`、`q`，返回 `items` 及 `total/page/pageSize/totalPages`；`total` 为用户可见且名称匹配的文档数，模板仅统计最新版本。未传参数仍返回全量 `items`，用于关联选择与旧客户端。无搜索时数据库分页；加密文档名称在服务端解密后筛选，不新增明文索引。

## 2026-10-29：直接仓库规则引用

`Matcher` 仍分 `rule` / `ruleset`。旧 `{ kind: 'ruleset', id }` 表示本地规则集，不迁移已有数据。仓库引用为 `{ kind: 'ruleset', id, repository: { repo, entry, name, sources } }`，其中 sources 固定本次选定的分支、路径、URL 与文本格式；id 为 `repo:` 加映射的 SHA-256 摘要前 32 位，不依赖显示名称。

`/rule-options/resolve` 根据仓库索引生成引用，不落本地文档；新引用经索引与 URL 校验，已发布引用仅在映射完全一致时按原映射使用。仓库引用内容不接受客户端改写和自定义拉取参数；需要定制时建立本地规则集。解析层将两类引用统一为 `RuleSetInputs`，之后快照、启用依赖收集、格式处理、托管/透传选择、缓存与旧版本资源保持原链路。

模板编辑 YAML 的 `x-sub-forge-rulesets` 保存别名到完整 Matcher 的映射，避免名称重用与跨来源重名改变引用。该元数据仅用于模板编辑器，不进入最终订阅配置。旧的无映射 YAML 按唯一名称导入；同名本地引用导出为 `local:<id>` 别名。

2026-10-29 模板编辑布局精简：行内规则集选择只替换 `RuleEntry.matcher`；`id`、顺序、`target`、`enabled` 和 `options.noResolve` 沿用现有对象与持久化语义，无领域模型或管线变更。


## 2026-10-29：SQLite v14 移除 GitHub 凭据

迁移删除 `server_secrets` 中的 `github-index-token`，表为空时删除表，存在未知其他服务凭据时保留。新数据库不建此表。订阅令牌、文档、索引与归属保持不变。仓库元信息通过 Git 获取，不新增领域字段，种子无此全局凭据，因此无需修改示例种子。

2026-10-29 规则集页面移除整组 no-resolve 开关及列表列。`RuleSet.noResolve` 作为旧数据兼容字段保留，编辑其他字段时继续原样保存并参与预览与渲染；新建规则集不设置该字段。规则级选项与管线不变，无需数据迁移。


2026-10-29：ruleKey 增加可选目标客户端；仅 mihomo 的进程 wildcard 与 DOMAIN-WILDCARD 对值执行 toLowerCase 后生成去重键，不改写 RuleIR 或来源内容。convertRuleDocuments 与 expandRuleSet 共用该键，替换及追加也参与；重复项保留来源行位并写为注释。单来源原文预览继续保留重复行。ruleSetDelivery 检测远程 wildcard 重复并强制托管（含 YAML），让实际下载与合并预览一致。客户端未指定时维持原有大小写敏感键，仓库索引计数不变。


2026-10-29 RAW 为单条编辑的默认表示，text 保存完整匹配原文，不含出口；client 改为可选，不设置时在目标客户端原样输出，设置时保留旧的客户端专用语义。新建与编辑写入 RAW；已有结构化 IR 不做批量迁移。RAW 不受 parseRuleLine 的类型枚举限制，不进行客户端方言翻译，语法由目标客户端解释。末尾 no-resolve / src 在 Lowering 中拆成选项，由 composeRule 在出口之后输出，避免重复；旧 RuleEntry 选项在表单回显时合入文本，编辑后移除独立副本。RAW wildcard 与结构化 wildcard 共用 mihomo 大小写去重键。空白及多行 RAW 不允许保存 / 发布或输出。模板 YAML 识别既有 RAW 并保留原文、稳定 ID 和覆盖；未知语法回落为 RAW，已支持的既有 IR 导入逻辑继续兼容。

## 2026-10-29：订阅分流所有权与数据库 v16

```ts
type RoutingConfig = Pick<Template, 'groups' | 'rules' | 'final'>;
type ProfileRouting =
  | { mode: 'bound'; templateId: ID; groupAdditions: Record<ID, GroupMember[]> }
  | { mode: 'independent'; config: RoutingConfig;
      initializedFrom?: { templateId: ID; version: number; name?: string } };
// Profile.routing 为新持久化入口；overlay: {} 仅保留兼容形状，不再同时存 template。
// 服务层额外存 revision、templateVersion（保存并发检查用，不锁定模板）和 migration 说明。
```

绑定输出 = 最新模板 + 按稳定组 ID 追加的成员。`groupAdditions` 保存期望状态，无操作回放链；反复保存不会重复追加。独立输出直接读取 config，不访问初始化模板。`resolveProfileRouting` 供渲染、规则依赖收集和校验共用，旧 `mergeTemplate` 仅保留迁移与编辑器适配能力。

数据库 v16 在同一事务中逐份展开旧配置，对迁移前后的标准化 groups/rules/final 做一致性比较；只将无诊断的 latest + append 纯成员覆盖转绑定，其余转独立。原始文档写入加密 `profile_migration_backups`，不修改 owner、updated_at、令牌、last_good 或结构版本资源。已有孤儿覆盖项原本就不生效，仍保存在原始备份中，迁移诊断保留，绝不悄悄将其激活。任一缺失版本、合并错误或输出不一致都回滚整批。旧种子导入使用同一转换；重复启动不重复迁移。

`POST /api/profiles/routing/convert` 接受订阅草稿、目标 mode、模板版本与组映射，返回草稿和变更清单，不写库。绑定转独立保留完整有效配置；重新绑定替换模板负责的结构、规则和最终出口，仅迁移显式映射的成员与代理链/节点回退引用。不迁移使用 null 明确表达，仍被引用的组不能丢弃。最终 PUT 使用 revision 原子保存，模板版本过期拒绝。发布前试渲染所有绑定订阅，检查过程中的并发改动拒绝发布。

`profile-migration-plan` 通过 SQLite backup 在临时一致性副本上迁移，源库只读；输出订阅名称、目标模式、原因及诊断，不包含完整配置或令牌。操作步骤见 server README。


### 2026-10-29：绑定模式前置规则扩展

`ProfileRouting` 的 `bound` 分支增加可选 `prependRules: RuleEntry[]`，按显示顺序保存，只允许 `matcher.kind: rule`，不携带锚点，不修改模板。缺省等同空数组，已有绑定订阅无需数据库迁移。有效规则为 `prependRules + template.rules`；禁用项保留顺序但不输出，最终出口仍为 `template.final`。编辑器通过倒序 top 锚点兼容旧覆盖层视图，保存仅写 routing。

前置节点出口共用 `resolveTarget / nameForNode`：按客户端自动处理，Mihomo Provider 生成精确过滤的隐藏组，Inline 直接引用，Stash 内联后直接引用；与代理链重复引用时复用依赖。保存及草稿预览检查出口归属、节点集已加入订阅、匹配项和规则 ID；规则 ID 不得与模板或其他前置规则冲突。模板发布检查全部前置出口（含禁用项、节点兜底组），删除所引用组或引入冲突 ID 时不可强制发布。绑定转独立会将前置规则完整固化，绑定间转换映射前置出口及兜底组。

规则出口也会生成隐藏引用组，因此代理链的成环与跳数检查在全部规则出口解析完成后执行，并展开 `include-all-proxies` 等动态成员。


### 2026-10-29：移除规则启停状态（SQLite v17）

`RuleEntry.enabled` 与 `RuleSetSource.enabled` 仅保留旧输入兼容。规则集保存、模板自检/发布、订阅保存/预览和种子导入将 `enabled:false` 的规则或来源移除，其他项清除 enabled 字段；同时清理仓库文件映射中的来源标记。当前数据以数组成员决定生效，不再持久化启停。

SQLite v17 在事务中处理规则集、全部模板历史版本、独立订阅规则和绑定订阅前置规则；先展开仍存在的旧覆盖层，再移除停用项，避免锚点丢失。文档归属、更新时间、模板版本号、订阅链接及历史渲染资源保持原值。旧备份保持原文。既有运行时兼容读取不影响新数据的规范化。旧 YAML 的 disabled 注释按删除对应规则导入，导出不再写该注释或启用字段。


2026-10-29 绑定规则页的说明位置、搜索区间距及规则行对齐仅为前端样式修正，不更改数据模型、接口、种子或输出规则。

## 2026-10-29：平面目录清单与级联选择

> 2026-10-29：本节目录树／逐层加载方案已被本文末尾的「规则来源平铺分页」替代；保留历史决策，当前不显示文件夹。

SQLite v18 新增 `rule_repo_catalog(repo, data)` 缓存：节点保存 `kind`、`ref`、`root`、`path`，可关联文件另含历史索引 `entry`。仅保存目录与 list/txt 文件元数据，不读取规则正文，不在服务端创建嵌套树。它与规则条目、配置快照、提交版本在同一事务中替换，失败保留上次完整结果。旧库缺少目录缓存时标记待更新，同一提交也补建。

`GET /api/rule-options/catalog?scope=all|repository` 返回当前用户可见本地规则集、启用仓库平面节点及索引提示。前端构造级联，叶子携带 `repo + entry + file(ref,path)`，`POST /api/rule-options/resolve` 校验并只返回该文件来源。历史聚合引用与示例种子的映射保留，不重新解释或改写旧模板、订阅；领域模型和渲染器沿用既有单文件来源结构。


2026-10-29 最新调整（取代前文独立 no-resolve 开关及兼容生效的说明）：规则集、规则增强、模板和订阅统一移除独立 no-resolve 配置。远程以来源文件每行的标记为准，本地单条与增强替换 / 追加以实际原文为准。数据库 v18 清理旧 `RuleSet.noResolve`、`RuleEntry.options.noResolve`，原文和结构化规则自身标记保留；预览、YAML 往返与下载遵循同一语义。历史已发资源仍保留版本。模板规则列表采用平整行布局，保留上下间距，主内容、来源、出口、删除分层呈现；无整行套娃边框。实现说明见 [规则转换](ruleset-conversion.md#no-resolve-以规则内容为准)。

2026-10-29：Client 新增 stash；服务端 Target 支持 mihomo/stash，并用客户端和平台隔离缓存、last-good、结构版本与资源地址。Preset.stash 和 Profile.base.stashPatch 保存 Stash 原生基础设置。renderStash 共用依赖/环路/规则流水线，独立转换节点和组；节点按快照内联。Stash 预览另返回 exportYaml，将已转换的托管规则内嵌，支持草稿独立文件导出。详见 [17](17-official-client-configuration-guides.md)。

## 2026-10-29：名称搜索谓词

`normalizeNameSearch`/`matchesNameSearch` 统一大小写、全半角与首尾空白处理。公开仓库缓存使用 SQLite `search_fold(value) LIKE ? ESCAPE` 与转义参数；本地加密文档先按权限读取、解密后包含筛选，再分页。节点接口支持 `q`，先解析完整节点集、按名称筛选，再执行 5000 条响应上限。此处只改变搜索候选，不改变 NodeRef 精确匹配或规则正则语义。

## 2026-10-29：按物理文件读取正文

`GET /api/rule-repos/file-preview?repo&ref&path` 先检查启用仓库和平面目录成员资格，再按索引固定 commit 读取单个 list/txt 文件。返回原始 content、文件名、路径、分支、许可证与源链接，不解析 README、不合并同目录文件、不创建本地文档。读取结束重验索引快照；索引变化或仓库停用时拒绝返回过期内容。目录与名称查询仍走 SQLite，正文通过现有 Git 对象缓存按需读取。原有来源和规则领域结构不变。


## 2026-10-29：规则目录逐层分页

> 2026-10-29：本节目录树／逐层加载方案已被本文末尾的「规则来源平铺分页」替代；保留历史决策，当前不显示文件夹。

`GET /api/rule-options/catalog` 改为有界分页响应 `{items,total,offset,limit,nextOffset?,notices}`，不再返回全部仓库平面节点。`scope=all|repository` 控制本地候选；不传 `repo` 只返回可见本地规则集与仓库入口，传 `repo` 和仓库根相对路径 `directory` 返回当前层。默认 `offset=0&limit=30`，最多 100 项；非法分页/目录返回 400，停用或不存在仓库返回 404。

`q` 在完整 SQLite 目录索引中按既有名称规则筛选，再按完整路径投影当前层、去除相同路径的重复目录、稳定排序并执行 LIMIT/OFFSET。保留原始路径的所有层级，例如 `rule/Clash/China` 与 `rule/Surge/China` 各自展示，不能剥离扫描根后按名称合并；文件保留仓库、完整路径、分支与 entry。正常分页查询不在应用层读取完整目录；缺失目录缓存时回退已有条目，并返回索引待更新提示。读取目录不拉正文，选中叶子后沿用现有单文件解析与授权。持久化领域模型、核心 IR、示例种子无需变更。

## 2026-10-29：规则来源平铺分页

`GET /api/rule-options/search?scope=all|repository&q=&offset=0&limit=30` 返回 `{items,total,offset,limit,nextOffset?,notices}`。每项 `{value,label,hint,disabled}`；value 为 JSON 编码的 `{source:'local',id}` 或 `{source:'repository',repo,entry,file:{ref,path}}`，可解析后传给 resolve。旧 `/rule-options/catalog` 逐层接口已移除。

SQLite 文件索引、本地授权候选在同一查询中筛选、排序和 LIMIT/OFFSET 分页，应用层只接收当前页文件。缓存缺失时通过 SQL 查询已有条目的文件变体，仍有界分页并提示待更新。`rule_repo_catalog` 保留表结构，新缓存仅保存 file/ref/path/entry；读取旧缓存时忽略 directory，刷新时自然替换。预览也按单个文件查询索引，无需枚举全部文件。领域文档、核心 IR、单文件来源映射和示例种子均不变。

2026-10-29 搜索范围修正：仓库候选的 searchable 仅取完整文件 path（含文件名），不拼接仓库名称或 ref；label/hint/value 不变。本地规则集沿用已有名称与备注搜索。核心 IR、领域文档与示例种子无需变更。

2026-10-29 展示协议补充：`/api/rule-options/search` 的 hint 仅包含仓库名、父目录、分支等来源说明，value 中的完整文件路径保持不变。候选新增 `matches:{label:SearchMatch[],hint:SearchMatch[]}`，每个区间为原始显示文本的 UTF-16 半开 `[start,end)`；服务端仅为本页生成区间，跨目录与文件名的命中投影到两行，来源说明不参与高亮。核心新增规范化命中到原文的映射工具，领域 IR 与示例种子不变。

2026-10-29 hint 格式调整：先在 matches 中按 repo 统计 `COUNT(DISTINCT ref)`，再执行当前页 LIMIT/OFFSET；分支数大于 1 才展示 ref。父目录为空时直接省略，不再填充 `/`。分支显示由当前查询全部匹配项决定，跨页稳定；hint 高亮区间按实际前缀长度生成。value、鉴权、文件身份、核心 IR 与示例种子保持不变。


2026-10-30 表单空值契约：placeholder 仅为前端元数据，不进入基础预设、覆盖补丁、IR 或生成配置。可选配置未填写时省略相应键；清空仍经现有 setPath 删除字段及空父对象，覆盖保留继承语义。false 与 0 是明确值，不做空值转换。API、数据库、领域结构及示例种子不变，无迁移。

### 2026-10-30：缓存并发与授权补充

资源身份包含用户/公开作用域及实际读取参数，MRS 类型进入身份并校验实际二进制。旧快照迁移绑定须匹配原读取身份。渲染捕获进程内配置修订与成功/尝试快照修订，异步校验后变化则重算，防止旧结果覆盖新状态；这不是新增文档字段。递归依赖权限和下发 token 在异步工作后复核，授权错误禁止 last_good 回退。来源换 URL 或删除后回收无其他绑定的缓存，已删除来源的迟到响应不留孤立原文。已浏览仓库文件根据仍有效的索引与绑定参与调度。数据库 schema 与示例种子无需修改。


### 2026-10-30：规则卡片与操作间距

来源选择仍仅为前端临时状态，新增外部点击取消；仓库来源的地址、关联信息和格式仍保留在数据中，仅隐藏卡片第二行。服务端、领域模型、渲染与示例种子不变。

2026-10-30 订阅弹窗合并：领域模型和示例种子不变，模板关联继续使用草稿转换接口。界面仅为有效填充、代理链及前置规则出口要求组映射，同 ID 或唯一同名自动匹配；被引用的组禁止映射为删除。取消整个组弹窗同时撤销成员和链修改。

### 2026-10-30：代理链编辑与来源移出约束

领域格式不变：Provider 前置写 `via.ref.match.regex`，Inline 前置写 `exact`，策略组写 `groupId`；Inline 落地用转义并首尾锚定的 `landing.filter`，Provider 整集落地省略筛选字段。`NodeRef` 正则沿用解析首个匹配节点的合同，界面显示命中数及当前采用节点；默认 wrap 仍生成针对该节点的精确隐藏组，避免动态扩大前置范围。整集落地沿用服务端 Provider 内容覆写，Stash 沿用整体内联翻译。

旧 `landing.filter/excludeFilter` 不迁移、不静默转整集；只有规范的精确筛选才回显为 Inline 单节点。移出来源的前端事务同时过滤节点集与直接引用它的链（含嵌套前置回退）；服务端保存/草稿预览增加落地节点集已加入本订阅的校验。策略组与规则成员继续使用原有引用校验，不在该事务中静默修改。

### 2026-10-30：自动引用与代理链诊断

移除手工依赖策略，不改变节点集的 Provider / Inline 选择。历史 `refPolicy.default` 与 `perRef` 仅兼容读取，渲染忽略；保存及草稿预览校验统一成 `{ default: 'wrap' }`，无需批量迁移旧库。示例种子的两份订阅已使用此兼容值，无旧逐项覆写。

渲染结果新增 `chainResolutions: { chainId, viaName?, landingCount, appliedCount, issues }[]`，预览接口原样返回。`viaName` 为实际解析名称，命中与实际应用数量分开，前置缺失或被整集规则覆盖时应用数为零。`ReportItem.chainIds` 关联冲突、环路和过长链；环路反向遍历覆盖依赖该环的链，避免漏报入口或误报无关链。前置组及嵌套组问题也归入相应卡片。完整报告保留，卡片合并重复环提示。

前端以持久化草稿及模板版本为查询键，防抖 450ms 自动调用现有预览接口，不写库。修改、重新检查或请求失败均不保留旧诊断。`dependencies` 留作配置预览默认折叠的只读生成详情，无策略编辑控件。

2026-10-30 代理链由流量卡片改为紧凑文本列表，仅调整前端展示；代理链、自动引用、接口与存储格式不变，示例种子已核对，无需迁移。

2026-10-30 名称与模板设置合并卡片：继续使用同一个 `Profile.name` 和现有模板转换/保存接口，名称同时用于客户端显示。前端统一入口并拦截空白名称；没有新增字段，示例种子与数据迁移不变。
