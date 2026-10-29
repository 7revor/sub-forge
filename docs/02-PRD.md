# 02 · 产品需求文档（PRD）

- 版本：v0.2（草案）
- 修订记录：
  - v0.2（2026-10-28）：回填第一轮采集结论（[07](07-verification-checklist.md)）与暂定决策（[07 §8](07-verification-checklist.md#8-决策记录)）；Surge 代理链改用组级 `underlying-proxy`；空组默认拒绝（TPL-10）；模板组在 Profile 中不可修改（PRF-09）；新增 §5 客户端兼容与订阅输出约定、§6 非功能需求、§7 信息架构
  - v0.1：初稿
- 首期输出目标：**mihomo**、**Surge**
- 优先级：**P0** = MVP 必须；**P1** = 首个正式版；**P2** = 之后

---

## 1. 背景与目标

维护者（下称"管理员"）为一小群用户提供订阅服务。用户的情况各异：有人只有一个机场，有人有十几个订阅源 + 自建节点 + 中转/落地链路。现有工具：

- **Sub-Store** 能满足大部分"节点加工"需求，但不生成完整配置，且无法让代理链/规则引用 `proxy-provider` 中的节点；
- **妙妙屋** 能可视化生成配置，但节点是有状态的（改名后再同步会重复/错乱），模板与订阅是一次性复制关系。

### 1.1 产品目标

| # | 目标 | 衡量方式 |
| --- | --- | --- |
| G1 | 节点加工确定性：同一份上游内容 + 同一条处理链 ⇒ 永远相同的输出 | 处理链为纯函数；无"节点记录"可被手工改动 |
| G2 | 多订阅源保持独立：按源输出 `proxy-provider`，客户端面板可按源查看、分别更新 | 默认不打平 |
| G3 | 代理链与规则可引用任何节点（含 provider 中的节点），生成的配置一定能通过客户端校验 | 渲染后用 mihomo 内核做 `-t` 校验 |
| G4 | 分流与节点解耦：模板只管分流，订阅只填节点；模板更新自动同步到所有订阅 | 订阅 = 模板 ⊕ 覆盖层，渲染时合并 |
| G5 | 一份规则，按客户端正确输出（如进程规则在 mihomo/Surge 的差异） | 规则中间表示 + 客户端降级/改写 |

### 1.2 非目标（首期）

- 不做流量探针/测速/面板美化（妙妙屋的探针、测速、壁纸等）。
- 不输出 Loon / Stash / QX / sing-box（架构上预留，见 [04](04-client-matrix.md)）。
- 不做节点售卖、计费。
- 不做 Gist 等第三方同步（Sub-Store 的 Artifact 同步）。

---

## 2. 用户角色

| 角色 | 能力 |
| --- | --- |
| 管理员 | 管理用户；维护**模板**、**基础设置预设**、**公共规则集**；可维护订阅源并**共享**给指定用户（用户不可见原始 URL） |
| 普通用户 | 管理自己的订阅源、组合、本地节点、规则集；基于模板创建**配置订阅**；获取订阅链接 |

---

## 3. 核心概念（术语表）

```
订阅源 Source ─┐
               ├─(处理链)→ 节点集 ─┐
组合 Collection ┘                  │
本地节点 LocalProxy ───────────────┤
                                   ▼
模板 Template ──(继承)──▶ 配置订阅 Profile ◀── 基础设置 BaseSettings
 (group 骨架 + rule + 关联)      (填充节点 / 覆盖层)
规则集 RuleSet ── (多个来源合并，    │
                  被 rule 引用)      ▼
                              渲染(客户端) → mihomo YAML / Surge conf
```

| 术语 | 定义 |
| --- | --- |
| **订阅源 Source** | 一个远程节点来源：一个或多个 URL 按序合并，产出一个节点列表。手写或粘贴的节点放在本地节点组，不放在订阅源 |
| **处理链 Pipeline** | 有序的处理器（Operator）列表：过滤、正则改名、排序、去重、加旗帜、快捷设置、脚本……**纯函数**：`(nodes, ctx) → nodes` |
| **组合 Collection** | 有序引用多个 Source/Collection（不可环），每个成员先跑自身处理链，合并后再跑组合自身的处理链 |
| **本地节点 LocalProxy** | 用户手写的节点（自建、中转等），可单独或成组使用 |
| **节点集 NodeSet** | Source / Collection / LocalProxy 组 的统称，可在订阅中作为一个 provider 输出 |
| **规则集 RuleSet** | 一组匹配条件（不含出口），由一个或多个**来源**（远程 URL / 本地规则）按序合并去重；可解析 Surge/Clash classical、domain、ipcidr、YAML payload、纯文本等。原「规则包 RuleBundle」于 2026-10-29 并入规则集 |
| **规则条目 Rule** | 配置中的一行分流：`匹配项（单条规则 / RuleSet） → 出口` |
| **策略组 ProxyGroup** | select / url-test / fallback / load-balance 等，成员可以是节点、节点集、其他组、内置策略 |
| **基础设置 BaseSettings** | 通用设置、DNS、TUN、嗅探等，按客户端分别描述，可做成预设 |
| **模板 Template** | **只包含分流**：ProxyGroup 骨架（不含节点）+ Rule 列表 + Rule→Group 的关联 |
| **配置订阅 Profile** | 最终交付给客户端的"整体订阅"：选择基础设置、节点集、模板，并在模板之上叠加覆盖层 |
| **覆盖层 Overlay** | Profile 相对模板的差异：给组填充成员、修改组参数、增删规则、改规则出口为节点等。以**稳定 ID** 指向模板元素 |

---

## 4. 功能需求

### 4.1 订阅源与处理链（对应需求 1）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| SRC-01 | 新建订阅源：远程 URL（支持多个 URL 合并为一个源）。早期版本还支持「本地文本」，2026-10-29 移除，粘贴导入改由本地节点组承担（LOC-01）：本地节点由用户自己命名，不需要处理链 | P0 |
| SRC-02 | 远程拉取参数：自定义 User-Agent、超时、拉取间隔（缓存 TTL）、是否经由某个代理拉取 | P0 |
| SRC-03 | **原始快照缓存**：保存最近一次成功拉取的原始内容和时间；拉取失败时使用快照并在 UI 标红 | P0 |
| SRC-04 | 解析主流协议：ss / ssr / vmess / vless(reality) / trojan / hysteria / hysteria2 / tuic / wireguard / anytls / snell / http / socks5 等；无法解析的节点列入"解析失败"列表而不中断 | P0 |
| SRC-05 | 透传并聚合 `subscription-userinfo`（流量/到期），在 Profile 输出中可选择汇总或取某个源 | P1 |
| SRC-06 | 处理链编辑器：可拖拽排序、单步启用/禁用、**逐步预览**（每一步之后的节点列表 + 与上一步的 diff） | P0 |
| SRC-07 | 内置处理器（P0）：正则过滤（保留/剔除）、正则改名（**正则链**，按序多条 `pattern → replacement`）、正则删除字符、按名称排序、按正则优先级排序、去重（改名加序号 / 删除）、地区旗帜（识别地区名、代码；流量与到期说明节点不添加）、协议类型过滤、快捷设置（udp/tfo/skip-cert-verify 等）、无用节点过滤（"剩余流量""到期"等） | P0 |
| SRC-08 | 脚本处理器：JavaScript 脚本 `(nodes, ctx) => nodes`，在**沙箱**中执行（超时、内存限制、无网络/文件访问）。**编写权限**：默认仅管理员，管理员可按用户授权；普通用户可引用管理员共享的脚本（Q8） | P1 |
| SRC-09 | 处理器复用：处理链可保存为"处理链片段"，被多个源/组合引用（引用而非复制） | P1 |
| SRC-10 | 节点稳定标识：每个节点在流水线中带隐式字段 `_source`（源 ID）、`_origName`（上游原名）、`_key`（协议+服务器+端口+凭据的哈希），供后续引用与去重使用；输出时剥离 | P0 |
| SRC-11 | 名称冲突检查：同一 NodeSet 输出前必须保证名称唯一（处理链末尾自动追加"去重"兜底） | P0 |

**设计约束**：系统**不存储"节点记录"**。任何改名、删除、排序都只能以处理器的形式存在。这是解决妙妙屋"改名后重新拉取重复"问题的根本手段。

### 4.2 组合（对应需求 2）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| COL-01 | 新建组合：有序选择多个 Source / Collection / 本地节点组，任意组合远程 + 本地 | P0 |
| COL-02 | 组合自身拥有处理链，在成员合并之后执行 | P0 |
| COL-03 | 成员级前缀/后缀等轻量配置（等价于自动插入一个改名处理器，避免多源同名） | P0 |
| COL-04 | 环检测：组合引用图必须是 DAG，保存时校验 | P0 |
| COL-05 | 单个成员拉取失败时的策略：使用快照 / 跳过该成员 / 整体失败 | P1 |

### 4.3 本地节点

| ID | 需求 | 优先级 |
| --- | --- | --- |
| LOC-01 | 表单或粘贴（URI 列表 / Base64 / Clash YAML / Surge [Proxy] 段）创建本地节点；YAML 支持单节点映射、裸节点列表及带 `proxies` 的完整配置，保留复制片段的整体缩进；语法错误显示诊断，可解析列表逐项报告无效节点。可分组（本地节点组即一个 NodeSet），本地节点组没有处理链 | P0 |
| LOC-02 | ~~本地节点可设置"前置"（dialer）：指向任意节点引用或策略组~~。**2026-10-29 移除**：本地节点只录入节点信息，不处理代理链；前置统一在配置订阅的「代理链」中用链规则设置（REF-03），落地选本地节点组即可。已有的本地节点前置在数据库 v6 迁移时改写为直接使用该分组的配置订阅中的链规则 | — |

### 4.4 策略组（ProxyGroup）可视化编辑

| ID | 需求 | 优先级 |
| --- | --- | --- |
| GRP-01 | 组类型：`select`、`url-test`、`fallback`、`load-balance`（Surge 映射见 [04](04-client-matrix.md)） | P0 |
| GRP-02 | 成员类型：<br>① 内置策略（DIRECT / REJECT / REJECT-DROP / PASS）<br>② 其他策略组（mihomo `proxies` 写组名；Surge 写组名或 `include-other-group`）<br>③ 节点集整体（mihomo `use: [provider]`；Surge `policy-path` / `include-other-group`）<br>④ 单个节点引用（见 4.6 节点引用）<br>⑤ "全部节点"（mihomo `include-all` / `include-all-proxies` / `include-all-providers`；Surge `include-all-proxies`） | P0 |
| GRP-03 | 组内过滤：`filter`、`exclude-filter`、`exclude-type`（mihomo）/ `policy-regex-filter`（Surge），UI 中实时显示命中的节点 | P0 |
| GRP-04 | 测速参数：`url`、`interval`、`timeout`、`tolerance`、`lazy`、`max-failed-times`、`expected-status`；负载均衡 `strategy`。Surge 的 `url`、`timeout` 语义与 mihomo 不同，按 [04 §2](04-client-matrix.md#2-策略组) 转换，无法表达的参数写入渲染报告 | P0 |
| GRP-05 | 展示参数：`hidden`、`icon`（Surge 为 `icon-url`）；Surge `no-alert` | P1 |
| GRP-06 | 其他：`disable-udp`、`interface-name`、`routing-mark`、`default-selected`、`empty-fallback` 等以"高级参数"KV 形式支持，并标注客户端适用范围 | P1 |
| GRP-07 | 依赖图校验：组之间不能成环；被引用的组/节点不存在时阻止保存或标红 | P0 |
| GRP-08 | 拖拽排序（组顺序即客户端面板顺序）；成员拖拽排序 | P0 |

### 4.5 分流规则（Rules）

#### 4.5.1 规则集 RuleSet

| ID | 需求 | 优先级 |
| --- | --- | --- |
| RS-01 | 来源：一个规则集可引用**多个**来源，每个来源是本地编辑的规则或远程 URL（带缓存与失败快照，同 SRC-02/03）；来源可排序、单独启用 / 停用（2026-10-29 起，取代原单一来源） | P0 |
| RS-02 | 可解析格式：Surge/Clash classical 文本（`TYPE,value[,options]`）、Surge `DOMAIN-SET`、mihomo rule-provider YAML（`payload:`，behavior=classical/domain/ipcidr）、纯域名/纯 CIDR 文本；sing-box 源格式 JSON 为 P2；`mrs` / `srs` 二进制只做**透传**不解析 | P0 |
| RS-03 | 解析后统一为规则中间表示（IR），记录无法解析/不支持的行 | P0 |
| RS-04 | 支持逻辑规则 `AND / OR / NOT`（作为单条规则） | P1 |
| RS-05 | 规则集对外提供转换后的下载地址（按客户端/behavior 输出），供配置中的 rule-provider / RULE-SET 引用（2026-10-29：规则集页面不再单独展示下载地址，实际地址以配置订阅「预览」为准） | P0 |
| RS-07 | **内置规则仓库**：可搜索内置 GitHub 规则仓库（blackmatrix7、zydou 等）并直接引用，按客户端自动挑选变体，详见 [08](08-rule-repository-index.md) | P0 |
| RS-08 | 编辑交互（2026-10-29）：新建与编辑共用同一页面，来源列表是页面第一块、直接编辑，不再有「编辑来源」对话框或单独的新建表单；点选某个来源时下方预览该来源的输出（本地规则可在预览里实时编辑），不选中时预览合并后的最终规则；预览跟随未保存的草稿 | P0 |
| RS-06 | 远程规则集"直接透传原 URL"模式：当无改写且格式与目标客户端兼容时，配置中直接引用上游 URL，减轻服务端压力 | P1 |

#### 4.5.2 规则包 RuleBundle（需求"多合一"）

> 2026-10-29：规则包不再单独成页，**并入规则集**。规则集本身可以引用多个远程 URL 与本地规则，合并后只配一个出口，下列需求由规则集承担：RB-01 → RS-01（多来源；原「单条规则」子项写进本地来源）；RB-02/03/05 → 规则集输出（只占一行、按 behavior 拆分、IP 类统一 no-resolve）；RB-04 → 规则集合并结果预览。旧数据中的规则包自动迁移为同 id 的规则集，模板与 Profile 中的引用随之改写。原条目保留如下备查。

| ID | 需求 | 优先级 |
| --- | --- | --- |
| RB-01 | 规则包包含有序子项：RuleSet（本地/远程）或单条规则；**最多两层**，禁止包含规则包 | P0 |
| RB-02 | 规则包作为一个整体出现在规则列表中，只配置**一个出口** | P0 |
| RB-03 | 输出时自动合并：按 behavior 拆分为最多三个 provider（domain / ipcidr / classical），全部指向同一出口；domain 类在前、IP 类在后（避免过早触发 DNS 解析） | P0 |
| RB-04 | 子项可单独启用/禁用；可查看合并后条目数与去重结果 | P1 |
| RB-05 | 规则包内 IP 类规则统一可选 `no-resolve` | P1 |

#### 4.5.3 规则列表

| ID | 需求 | 优先级 |
| --- | --- | --- |
| RL-01 | 规则自上而下顺序匹配，UI 拖拽排序；末尾固定 `MATCH`/`FINAL` | P0 |
| RL-02 | 规则条目的匹配项：单条规则 / RuleSet / GEOSITE / GEOIP（RuleBundle 已并入 RuleSet，2026-10-29） | P0 |
| RL-03 | 规则条目的出口：策略组 / 内置策略 / **单个节点**（含 provider 中的节点，见 4.6）。**模板中只能选策略组或内置策略** | P0 |
| RL-04 | 规则级选项：`no-resolve`、`src`；Surge `extended-matching` 等，按客户端适用 | P1 |
| RL-05 | 规则级"仅对某客户端输出 / 某客户端改写"，见 4.5.4 | P0 |

#### 4.5.4 按客户端的规则改写（需求"脚本编辑增强"）

不同客户端对同一语义的规则写法不同，典型如进程规则：

| 语义 | mihomo | Surge |
| --- | --- | --- |
| 进程名精确 | `PROCESS-NAME` | `PROCESS-NAME`（Surge 的 PROCESS-NAME 同时接受名称或完整路径，区分大小写，仅 macOS） |
| 进程路径精确 | `PROCESS-PATH` | `PROCESS-NAME,<完整路径>` |
| 名称/路径通配（`*` `?`） | `PROCESS-NAME-WILDCARD` / `PROCESS-PATH-WILDCARD` | `PROCESS-NAME` 中直接写通配符（名称模式与路径模式都支持） |
| 名称/路径正则 | `PROCESS-NAME-REGEX` / `PROCESS-PATH-REGEX` | 不支持 ⇒ 尝试转通配，否则丢弃并告警 |
| Android 包名 | `PROCESS-NAME`（Android 上匹配包名） | 不适用 |

| ID | 需求 | 优先级 |
| --- | --- | --- |
| CR-01 | 规则 IR 中引入**语义化进程规则** `process(kind=name|path, mode=exact|wildcard|regex, value)`，渲染时按客户端降级（见 [04 §3](04-client-matrix.md#3-规则映射)）；不可表达时丢弃并在渲染报告中告警 | P0 |
| CR-02 | 声明式客户端覆盖：任一规则可设置；规则集在独立区块中按规则内容精确匹配所有启用来源，不再提供行号定位或来源绑定（2026-10-29）。可设置 `{client: mihomo|surge, platform?: android|macos|windows|ios|linux} → 替换为 / 丢弃` | P0 |
| CR-03 | 规则改写脚本：对 RuleSet（或其中某个来源）挂 JS 脚本 `(rule, ctx) => rule | rule[] | null`，`ctx.client`、`ctx.platform` 可用；沙箱执行；编写权限同 SRC-08 | P1 |
| CR-04 | 客户端识别：优先 URL 参数 `?target=mihomo|surge&platform=...`，其次 User-Agent 自动识别（mihomo 内核 / Clash Verge / FlClash / ClashMetaForAndroid / Surge iOS/macOS）；识别结果在访问日志中可见 | P0 |
| CR-05 | 规则预览：选择客户端 + 平台，实时查看规则集最终输出 | P0 |

### 4.6 节点引用、代理链与依赖解析（对应需求 3，**核心差异点**）

**问题**：mihomo 的 `dialer-proxy` 和 rule 出口只能指向本地 `proxies` / `proxy-groups` 的名字，不能指向 `proxy-providers` 里的节点；而我们希望多订阅源保持 provider 形式（面板按源分组、分别更新）。

**结论**：节点引用由系统**自动解析**（用户不需要显式声明"内置节点"），解析结果在 UI 中**可见、可改策略**。

**通解**（调研见 [06](06-proxy-chain-research.md)）：mihomo 的 `dialer-proxy` 在拨号时按名称到顶层表（本地节点 + 所有组 + 内置策略）中查找，provider 节点也能写 `dialer-proxy`。因此：
- **落地侧**：`dialer-proxy` 永远写在落地节点上，本地节点写进 `proxies`，provider 节点写进本服务下发的 provider 内容；
- **前置侧**：值永远是顶层名称，前置在 provider 中时用隐藏包装组升格。

前置和落地各自在本地还是 provider 中，四种组合都能处理，不需要打平。

**Surge**（[06 §5](06-proxy-chain-research.md#5-surge)）：外部节点集用 `policy-path`（Q9）。前置侧同样用隐藏包装组；落地侧用带**组级 `underlying-proxy`** 的隐藏组包住落地节点，不需要按 Profile 注入外部内容。组级 `underlying-proxy` 要求 Surge iOS 5.22.0 / Mac 6.9.0+，低版本下外部节点集上的代理链不输出并提示。

| ID | 需求 | 优先级 |
| --- | --- | --- |
| REF-01 | **节点引用**：在任何可以选择"单个节点"的地方（组成员、规则出口、前置），保存的是 `NodeRef = { nodeSet: ID, match: 精确名称 | 正则, pick: first }`，而不是节点快照。上游变化后按引用重新解析 | P0 |
| REF-02 | 引用解析失败（上游已无该节点）时的兜底：可配置 `fallback = 某个组 / DIRECT / REJECT / 报错`，并在 Profile 状态页告警 | P0 |
| REF-03 | **代理链配置**：在 Profile 中配置"链规则"：`落地 = 某 NodeSet 中匹配 filter 的节点` → `前置 = NodeRef 或 策略组`。可配置多条。**代理链只在这里设置**（2026-10-29 起本地节点不再设置前置，见 LOC-02），在选好节点集、策略组与规则之后配置；订阅源自带的前置由 REF-04 自动识别，不是设置项 | P0 |
| REF-04 | **上游自带的 dialer-proxy**：订阅中节点本身带 `dialer-proxy`/`underlying-proxy` 时，自动识别其前置并纳入依赖解析 | P0 |
| REF-05 | **依赖解析策略**（对每个"被引用但位于 provider 中的节点"），三选一，Profile 级默认 + 单项覆盖：<br>① **包装组**（默认）：生成隐藏 select 组 `use: [该 provider]` + `filter: ^<转义后的节点名>$` + `hidden: true`，引用方指向此组。**不打平、不复制**<br>② **复制到本地**：把该节点复制一份到 `proxies`（provider 中保留原节点），名称冲突时加后缀<br>③ **整体内联**：该 NodeSet 整体改为内联输出<br>Surge 的包装组写法见 [03 §4.3](03-domain-model-and-pipeline.md#43-surge-的对应处理) | P0 |
| REF-06 | **落地节点在 provider 中**：provider 节点可以引用主配置中的组和节点，所以系统按 Profile 生成**专属 provider 地址**，在下发的 provider 内容中给命中的落地节点注入 `dialer-proxy`；整源都需要同一前置时，直接用 `override.dialer-proxy`。Surge 不注入外部内容，改为生成带组级 `underlying-proxy` 的隐藏组 | P0 |
| REF-07 | "依赖节点"面板：列出本 Profile 所有自动引入的包装组/复制节点、引用来源（哪个组/规则/链）、当前策略，允许逐项切换策略 | P0 |
| REF-08 | **服务端引用校验**（P0）：渲染时校验所有 `dialer-proxy`、规则目标、组成员都能在顶层表中找到。provider 内节点的 `dialer-proxy` 在 mihomo 加载时不校验，写错只会在运行时连接失败，必须由服务端兜住。另外可选用内置 mihomo 内核执行 `-t`（P1），校验失败时返回上一份成功版本并告警 | P0 |
| REF-09 | 链长度与环检测：前置链不得成环（mihomo 自带的环检测只覆盖本地节点，跨 provider 的环由服务端检测）；超过 3 跳给出提示 | P0 |
| REF-10 | **防静默直连**：包装组一律输出 `empty-fallback: REJECT`。provider 未加载完成或节点消失时，mihomo 默认回退到 `COMPATIBLE`（即直连），会让落地绕过前置（已实测复现）。Surge 组无可用成员时同样回退 DIRECT，且没有对应参数：暂用 `fallback, <筛选组>, REJECT` 结构（D2），运行时验证前在 UI 与渲染报告中标注"Surge 防泄漏未验证" | P0 |
| REF-11 | **主配置与 provider 一致**：包装组名用稳定哈希（不随显示名变化）；Profile 专属 provider URL 带内容版本参数，链配置变化后 URL 也变，客户端重载主配置时会重新下载 provider。为此 `proxy-providers` **不输出 `path`**（写了 `path` 时改 URL 不会触发重新下载，已实测） | P0 |
| REF-12 | 前置可以是策略组：链规则的前置选一个组（如"🌠 中转"），用户在面板中切换中转后，所有落地随之切换。mihomo 与 Surge 都支持（D1） | P0 |

> 说明：用户原话"最好是可选项 + 重复设置"——REF-05 的策略②即"重复"（provider 里留一份、本地再放一份），策略①是更推荐的"零重复"方案；两者都可选。

### 4.7 基础设置（BaseSettings）

| ID | 需求 | 优先级 |
| --- | --- | --- |
| BS-01 | mihomo：通用（`mixed-port`、`allow-lan`、`bind-address`、`mode`、`log-level`、`ipv6`、`unified-delay`、`tcp-concurrent`、`find-process-mode`、`global-client-fingerprint`、`profile`、`external-controller`/`external-ui`/`secret`）、**DNS**（`enable`、`enhanced-mode`、`fake-ip-range`、`fake-ip-filter`、`default-nameserver`、`nameserver`、`fallback`/`fallback-filter`、`nameserver-policy`、`proxy-server-nameserver`、`direct-nameserver`、`respect-rules`）、`sniffer`、`tun`、`geox-url`/`geodata-mode` | P0 |
| BS-02 | Surge：`[General]`（`dns-server`、`encrypted-dns-server`、`skip-proxy`、`tun-excluded-routes`、`ipv6`、`loglevel`、`internet-test-url`、`proxy-test-url`、`test-timeout`、`always-real-ip`、`hijack-dns` 等）、`[Host]` | P0 |
| BS-03 | 管理员可发布基础设置预设（如 "fake-ip 推荐" / "redir-host 推荐"），Profile 可引用预设并做少量覆盖；预设更新同步到引用方（同模板机制） | P0 |
| BS-04 | 原样片段：每个客户端可追加一段原始 YAML / INI（如 Surge `[MITM]`、`[Script]`），作为逃生通道 | P1 |
| BS-05 | `find-process-mode` 与进程规则联动提示：Profile 中存在进程规则而 `find-process-mode: off` 时告警 | P1 |

### 4.8 模板（Template）

模板**只包含分流**：ProxyGroup 骨架 + Rule 列表 + 二者关联。

| ID | 需求 | 优先级 |
| --- | --- | --- |
| TPL-01 | 模板中的组：可设置类型、测速参数、展示参数、为空时的行为（TPL-10）；成员**只能是**其他模板组或内置策略，组之间的嵌套关系属于模板、随模板同步（Q5）。**不能包含任何节点/节点集，也不预设 `filter`/`exclude-filter`/`exclude-type`**（节点筛选全部在 Profile 中设置） | P0 |
| TPL-02 | 模板中的规则：匹配项可为单条规则 / RuleSet（RuleBundle 已并入 RuleSet，2026-10-29）；**出口只能是模板组或内置策略** | P0 |
| TPL-03 | 每个模板组可标注"填充提示"（如"建议放香港节点"、"建议放所有节点"），在 Profile 填充时展示（仅文字提示，不参与渲染） | P1 |
| TPL-10 | **空组输出**：模板组在 Profile 中未填充任何成员时，照常输出为"空组"，并在渲染报告与 Profile 页提示。每个模板组声明**为空时**的行为：**拒绝（默认）**或直连。例如"🤖 AI 服务"保持拒绝，避免未填充时流量悄悄直连；"国内媒体"可设为直连。输出：拒绝 → mihomo `proxies: [REJECT]`、Surge `select, REJECT`；直连 → mihomo `proxies: [COMPATIBLE]`、Surge `select, DIRECT`（两个客户端都不接受无成员的组，必须写一个内置成员） | P0 |
| TPL-04 | 模板元素（组、规则）具有**稳定 ID**；改名不影响已有 Profile 的覆盖层 | P0 |
| TPL-05 | 模板版本：每次发布生成新版本号与变更说明；可查看版本间 diff | P0 |
| TPL-06 | 订阅跟随策略：**跟随最新**（默认）/ 锁定某版本。跟随最新时模板发布即对所有订阅生效（订阅在渲染时合并模板，不复制） | P0 |
| TPL-07 | **模板发布前校验**（P0）。模板更新**不需要订阅方确认**，发布后对所有跟随最新的 Profile 立即生效，所以发布前必须检查：<br>① **模板自身**（不通过则禁止发布）：组/规则引用的组都存在、组之间没有环、规则集可拉取可解析、final 已设置（原「规则包没有超过两层」随规则包并入规则集取消，2026-10-29）；<br>② **对现有 Profile 的影响**（逐个试渲染新版本，结果展示给管理员）：会渲染失败的 Profile（阻断项，需确认后才能强制发布）、会出现孤儿覆盖项或空组的 Profile（警告）；<br>③ 结果按"错误 / 警告"分级，列出具体位置并可跳转 | P0 |
| TPL-11 | 编辑中实时校验：模板编辑器保存草稿时即时运行 ① 的检查，问题项在编辑器中标红 | P0 |
| TPL-12 | 强制发布后仍渲染失败的 Profile：订阅接口继续返回该 Profile 上一份成功的渲染结果，并在 Profile 页和管理员页提示 | P0 |
| TPL-08 | 模板可见性：管理员模板（对全部/指定用户可见）；用户私有模板 | P1 |
| TPL-09 | 导入：从现有 mihomo YAML 中抽取 proxy-groups + rules 生成模板（剥离节点） | P1 |

### 4.9 配置订阅（Profile，"整体订阅"）——最终使用入口

新建 Profile 的向导：

1. **基础设置**（可选）：选预设 / 自定义 / 不输出（使用客户端默认）。
2. **节点**：选择若干 NodeSet（Source / Collection / 本地节点组），每个指定输出方式：
   - `provider`（默认，mihomo 输出为 `proxy-providers`，指向本服务的 provider 地址；Surge 输出为 `policy-path`，见 [04](04-client-matrix.md)）
   - `inline`（展开到 `proxies` / `[Proxy]`）
   - 代理链与依赖节点**无需在此显式添加**，由 4.6 自动解析。
3. **模板**：选择模板（或空白）。
4. **填充策略组**：对每个模板组添加成员（节点集 / 单节点引用 / 其他组），可覆盖组参数；模板组**不能删除、改名或隐藏**（Q6）；可新增 Profile 私有组。
5. **规则**：继承模板规则；可：禁用某条模板规则、把某条模板规则的出口改为**已加入的节点**、在指定锚点前后插入私有规则。
6. **代理链**：配置链规则（REF-03），查看依赖节点面板（REF-07）。
7. **预览与发布**：选择客户端+平台预览最终配置、渲染报告（告警/降级/丢弃项）。

| ID | 需求 | 优先级 |
| --- | --- | --- |
| PRF-01 | 上述向导 + 之后可在单页中修改各部分 | P0 |
| PRF-02 | 订阅链接：`/sub/<token>`，根据 UA/参数输出 mihomo 或 Surge；token 可重置；可设置多个链接（给不同设备） | P0 |
| PRF-03 | Profile 是"模板引用 + 覆盖层"，**不保存渲染结果**（只做缓存）；模板/基础预设/节点集任何一方变化，下次请求即反映 | P0 |
| PRF-04 | 覆盖层孤儿处理：模板删除了某组/规则后，对应的覆盖项标为"孤儿"，不输出，在 Profile 页提示用户清理 | P0 |
| PRF-05 | 规则出口改为单节点时，可选范围仅限本 Profile 已加入的 NodeSet 中的节点 | P0 |
| PRF-06 | 渲染缓存：按 (Profile, 客户端, 平台, 各依赖的版本/快照哈希) 缓存；任一依赖变化自动失效 | P1 |
| PRF-07 | 访问日志：最近访问时间、UA、识别出的客户端、渲染耗时、告警数 | P1 |
| PRF-08 | 复制 Profile；导出当前渲染结果为文件 | P1 |
| PRF-09 | 模板组在 Profile 中只能填充成员、调整类型与测速等参数，**不能删除、改名或隐藏**（Q6）；用户不需要某个模板组时，可以不填充，由 TPL-10 的空组行为兜底 | P0 |

### 4.10 系统与安全

| ID | 需求 | 优先级 |
| --- | --- | --- |
| SYS-01 | 多用户：管理员创建用户、重置密码、禁用；用户之间数据隔离 | P0 |
| SYS-02 | 远程拉取仅限制 URL 中直接填写的内网 / 保留 IP，管理员可配置白名单；不拦截域名解析后的 IP，以兼容 Fake-IP（2026-10-29 修订）；重定向逐跳检查 URL | P0 |
| SYS-03 | 用户脚本沙箱：QuickJS / isolated-vm 级隔离，限时限内存，无 I/O | P1 |
| SYS-04 | 敏感数据（订阅 URL、节点凭据、token）加密存储 | P1 |
| SYS-05 | 订阅接口限流与异常 UA 拦截 | P1 |
| SYS-06 | 管理员共享：把自己的 Source/Collection 共享给指定用户，用户只能引用、不可见原始 URL | P1 |
| SYS-07 | 备份/恢复（导出全部配置为 JSON） | P1 |
| SYS-08 | 单容器部署（Docker），SQLite 存储 | P0 |

---

## 5. 客户端兼容与订阅输出约定

### 5.1 最低支持版本

| 客户端 | 最低版本 | 依据 |
| --- | --- | --- |
| mihomo 内核（Clash Verge Rev、FlClash、ClashMetaForAndroid 等） | **v1.19.27** | 包装组防泄漏依赖 `empty-fallback`（REF-10），自 v1.19.27 起支持。该版本同时满足：`PROCESS-*-WILDCARD`（v1.19.19）、`DOMAIN-WILDCARD`（v1.19.12）、mrs 规则集（v1.18.7）、组 `hidden`（v1.18.1）、`include-all`（v1.17.0）。D3：不按版本降级输出 |
| Surge iOS / Mac（基线） | **iOS 5.8.0 / Mac 5.4.0** | `hysteria2`、`extended-matching` 自该版本起支持；`include-other-group` 更早（iOS 4.12.0 / Mac 4.5.0） |
| Surge iOS / Mac（完整功能） | **iOS 5.22.0 / Mac 6.9.0** | 组级 `underlying-proxy`：外部节点集上的代理链（REF-06）依赖它 |

低于最低版本时的处理：

| 情况 | 处理 |
| --- | --- |
| mihomo 低于 v1.19.27 | 照常输出，渲染报告与访问日志告警"内核版本过低，代理链防泄漏不生效" |
| Surge 介于基线与完整功能之间 | 外部节点集上的代理链不输出（Q9：不内联回退），渲染报告提示；其余功能正常 |
| Surge 低于基线 | 照常输出，渲染报告告警 |
| 无法从 UA 识别版本 | 按满足完整功能输出，并在访问日志中记录原始 UA。各客户端 UA 格式见 [07 §7.1](07-verification-checklist.md#71-剩余采集项)（待采集） |

按版本启用的小特性（低版本时省略，不告警）：Surge `icon-url`（Mac 6.5.0+）、`category`（iOS 5.23.0+ / Mac 6.10.0+）、HTTPS 测速地址（iOS 5.23.0+ / Mac 6.10.0+）、`[Host]` 多个 DNS 服务器（iOS 5.21.0+ / Mac 6.8.0+）。

### 5.2 订阅输出约定

| ID | 需求 | 优先级 |
| --- | --- | --- |
| OUT-01 | **主配置** `GET /sub/:token`：mihomo 输出 YAML；Surge 输出 conf，**首行**为 `#!MANAGED-CONFIG <本订阅地址> interval=<秒> strict=false`，每次下发都必须带这一行（否则 Surge 会把它退化为普通配置）。`interval` 取 Profile 的更新间隔，默认 86400 | P0 |
| OUT-02 | **响应头**：<br>· `subscription-userinfo: upload=<B>; download=<B>; total=<B>; expire=<unix 秒>`，内容按 SRC-05 的设置（汇总或取某个源）；没有流量信息时不输出<br>· `profile-update-interval: <小时>`，与 OUT-01 的间隔一致<br>· `content-disposition: attachment; filename*=UTF-8''<Profile 名>`，作为客户端中的订阅显示名<br>各客户端是否读取这些头待采集（07 C4），不影响输出 | P0 |
| OUT-03 | **外部节点集** `GET /p/:token/:nodeSetKey`：mihomo 输出 `proxies:` YAML；Surge 输出逐行 `[Proxy]` 格式（不带段标题）。URL 带内容版本 `?v=`（REF-11） | P0 |
| OUT-04 | **规则集** `GET /r/:token/:rulesetKey`：按 `behavior`、`format` 输出（RS-05）；托管的仓库规则保留来源注释与许可证声明（R2） | P0 |
| OUT-05 | **失败处理**：渲染失败或校验失败时返回上一份成功结果（REF-08、TPL-12），HTTP 200；从未成功渲染过时返回 HTTP 503 与纯文本错误说明，不返回半成品配置 | P0 |
| OUT-06 | token 无效或已重置：返回 HTTP 404，不暴露 Profile 是否存在 | P0 |

---

## 6. 非功能需求

> 标 **待确认** 的数值是按"小规模用户群"假设填写的默认值，维护者确认后去掉标记。

| 类别 | 要求 |
| --- | --- |
| 规模 | 用户 ≤ 50；每用户 Profile ≤ 10、订阅源 ≤ 30；单个 NodeSet ≤ 2000 个节点；单个规则集（含全部来源）展开后 ≤ 20 万条（**待确认**） |
| 订阅接口性能 | 缓存命中时渲染 P95 < 200 ms；缓存未命中（需重跑处理链与规则展开）P95 < 2 s（**待确认**）。**订阅请求从不等待上游拉取**：快照过期时先用旧快照渲染并返回，后台刷新（stale-while-revalidate，03 §7） |
| 上游拉取 | 订阅源默认 TTL 24 小时，最短 5 分钟（保存时校验）；拉取失败后至少间隔 min(TTL, 5 分钟) 再自动重试；远程规则集默认 24 小时；规则仓库索引每日重建；单次拉取超时默认 10 s；同一 URL 的并发拉取合并为一次（**待确认**） |
| 可用性 | 单实例部署，不要求高可用。上游失败时使用最近一次成功快照（SRC-03），快照与配置持久化在 SQLite；渲染缓存可以随重启丢失 |
| 资源 | 单容器在 1 vCPU / 512 MB 内存下满足上述性能（**待确认**）；内置 mihomo 二进制用于 `-t` 校验，按需启动、执行完退出 |
| 脚本沙箱 | 单次执行 ≤ 1 s、内存 ≤ 64 MB；超限终止并在报告中记录，按"该处理器失败"处理，不影响其他处理器（**待确认**） |
| 数据保留 | 每个订阅源保留最近 5 份内容不同的成功快照（内容无变化的拉取只更新时间）；访问日志保留 30 天；模板保留全部版本（**待确认**） |
| 前端 | 支持主流桌面浏览器最近两个大版本；Profile 预览、订阅链接复制等常用操作在手机浏览器上可用 |

---

## 7. 信息架构

页面清单（文字版，不含视觉稿）。括号内为对应需求。

### 7.1 普通用户

| 一级导航 | 页面 | 主要内容 |
| --- | --- | --- |
| 总览 | 总览 | 我的 Profile 列表及状态（最近访问、告警数）、拉取失败的订阅源、孤儿覆盖项提醒（PRF-04、SRC-03） |
| 节点 | 订阅源列表 / 详情 | 源配置、拉取参数、快照历史、流量信息；**处理链编辑器**与逐步预览（SRC-01–11） |
|  | 组合列表 / 详情 | 成员排序、成员前后缀、组合处理链与预览（COL-01–05）；处理链编辑器在详情页当页展开（与订阅源一致），预览跟随未保存的成员与处理链草稿（2026-10-29 取代单独的处理链编辑页） |
|  | 本地节点 | 本地节点组、表单 / 粘贴创建（LOC-01）；不设置前置，代理链在 Profile 中配置 |
| 规则 | 规则集 | 列表、新建与编辑共用一页：来源（多个远程 URL / 本地规则）、独立的组级客户端改写（仅按规则内容定位）、输出预览（选中来源 / 合并结果，本地规则实时编辑）（RS-01–08、CR-02–03） |
|  | ~~规则包~~ | 2026-10-29 并入规则集，不再单独成页（见 4.5.2） |
|  | 规则仓库 | 搜索、按客户端查看变体、引用为规则集或作为远程来源加入已有规则集（RS-07，08） |
| 模板 | 向导中选择模板 | 2026-10-29 调整：普通用户不显示独立「模板」入口；创建配置订阅时仍可选择已发布模板。原独立浏览页由管理员统一入口取代；私有模板（TPL-08，P1）尚未实现 |
| 配置订阅 | Profile 列表 | 新建（进入向导，4.9）、复制、删除 |
|  | Profile 详情 | 分标签页：**概览**（订阅链接与 token、访问日志，PRF-02、PRF-07）· **基础设置** · **节点集** · **策略组**（填充模板组、私有组）· **规则**（继承与覆盖）· **代理链**（链规则、依赖节点面板，REF-03、REF-07）· **预览**（按客户端 + 平台查看最终配置与渲染报告，CR-05） |
| 设置 | 账户 | 修改密码；脚本权限状态（Q8） |

### 7.2 管理员额外页面

| 一级导航 | 页面 | 主要内容 |
| --- | --- | --- |
| 模板 | 模板列表 / 编辑器 | 2026-10-29 合并原「模板管理」入口；仅管理员可见、可编辑与发布。组骨架、规则、为空时行为、填充提示；草稿实时校验（TPL-11）；版本 diff（TPL-05） |
|  | 发布 | 发布前校验与影响分析结果，按错误 / 警告分级，可跳转到具体 Profile（TPL-07、TPL-12） |
| 预设 | 基础设置预设 | mihomo / Surge 分段编辑，引用方列表（BS-03） |
| 规则仓库 | 仓库管理 | 启用 / 停用内置仓库、自定义仓库与适配器、镜像地址、索引状态与报告（REPO-01–08、R4） |
| 用户 | 用户管理 | 创建、禁用、重置密码；脚本授权（Q8）；共享的订阅源与组合（SYS-06） |
| 系统 | 系统设置 | SSRF 白名单（SYS-02）、备份与恢复（SYS-07）、内置 mihomo 版本与校验开关 |


### 7.3 通用交互：删除

- 详情页：「删除」是头部操作区最右侧（保存之后）的独立按钮，所有顶部操作（包括重命名、复制等）依次平铺显示，不使用「更多」折叠菜单；空间不足时自动换行。
- 列表页：每行操作为「删除」「编辑」两个按钮，删除在左。适用于订阅源、组合、本地节点分组、规则集、配置订阅，以及本地节点分组详情的节点表。
- 删除一律先弹确认对话框；被引用时服务端拒绝，对话框里列出引用方。
- 2026-10-29 起替代原先「删除走『更多』菜单 → 确认对话框」的约定。

---

## 8. 关键用户场景（验收用例）

1. **多源不打平**：用户 A 有 8 个机场。创建 Profile，8 个源均以 provider 输出；Clash Verge 中可按 provider 查看与单独更新。✅ 生成的 YAML `proxies` 为空或只含本地节点。
2. **改名确定性**：源 X 处理链把 `香港 01 | 0.5x` 改名为 `🇭🇰 HK-01`。上游新增 `香港 02`、删除 `香港 01` 后重新拉取：结果为 `🇭🇰 HK-02`，不存在重复或残留名称。
3. **落地走中转（provider 内节点）**：用户 B 的落地节点在源 L（provider），中转节点在源 T（provider）的 `🇭🇰 IPLC-01`。配置链规则 "L 全部 → T:`🇭🇰 IPLC-01`"。✅ mihomo：输出中生成隐藏组 `__ref_T_xxx`（`use: [T]`, `filter: ^🇭🇰 IPLC-01$`, `empty-fallback: REJECT`），L 的专属 provider 内容中每个节点带 `dialer-proxy: __ref_T_xxx`；`mihomo -t` 通过。✅ Surge（Mac 6.9.0+）：生成包装组 `__ref_T_xxx` 与 `__chain_L_xxx = select, policy-path=<L>, underlying-proxy=__ref_T_xxx, hidden=true`，L 的节点在面板中显示为 `Name (via __ref_T_xxx)`；`surge-cli --check` 通过。
4. **规则出口为 provider 节点**：规则 `RuleSet(金融服务，多来源) → 源 S 中的 "🇺🇸 Home-Broadband"`。✅ mihomo 输出包装组并在规则中引用；Surge 输出 `select` + `fallback, …, REJECT` 两层包装组并在规则中引用。
5. **模板更新同步**：管理员在模板中新增 "🤖 AI 服务" 组和对应规则并发布。✅ 所有"跟随最新"的 Profile 下次拉取即包含该组；该组尚未填充成员时，按空组输出（TPL-10），默认拒绝：mihomo 中显示为仅含 `REJECT` 的组，相关流量被拒绝而不是直连，配置校验通过。
6. **进程规则分客户端**：规则 `process(path, wildcard, "/Applications/*/WeChat.app/*")`。✅ mihomo 输出 `PROCESS-PATH-WILDCARD,...`；Surge macOS 输出 `PROCESS-NAME,...`；Surge iOS 丢弃并在报告中注明。
