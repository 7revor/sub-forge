# 07 · 待核对清单（本地采集用）

> **状态：采集中。** 云端环境访问不了 `manual.nssurge.com`、`wiki.metacubex.one`、Loon / Stash 文档站，也不能执行 mihomo 二进制。
> 下列问题由维护者在本地电脑上**全部采集完之后再统一决策**；采集完成前，依赖这些结论的设计（标注 ⚠ 的位置）保持草案状态，不进入实现。

## 0. 怎么填写

每一项都包含：

- **问题**：要回答的具体问题（尽量是是/否或枚举）；
- **怎么查**：文档页面或实测步骤；
- **影响**：答案为"是"或"否"时，设计分别怎么走；
- **采集结果**：填原文摘录、截图路径或实测输出（**只记录事实，不做决定**）。

全部采集完后，在 §8 汇总决策。

---

## 1. Surge

参考入口：<https://manual.nssurge.com/>（策略组 `policy/group.html`、代理 `policy/proxy.html`、规则 `rule/*.html`、托管配置 `others/managed-configuration.html`）。

### S1 · 外部节点集：`policy-path`

| | |
| --- | --- |
| 问题 | ① 组参数 `policy-path=<url>` 的确切写法；② URL 返回的内容格式（`[Proxy]` 段的逐行 `name = type, ...`？还是需要整段带标题？）；③ 更新间隔参数名（`update-interval`？）；④ 一个组能否写**多个** `policy-path` |
| 怎么查 | 手册"策略组"页；实测：建一个组带两个 `policy-path` 看是否报错 |
| 影响 | ④ 为"否" → 一个组含多个节点集时，渲染层为每个节点集生成隐藏子组，再在父组用 `include-other-group` 合并（04 §2 现行方案）；为"是" → 直接写多个 |
| 采集结果 | |

### S2 · 外部节点能否按名称被引用（代理链前置侧）

| | |
| --- | --- |
| 问题 | `policy-path` 引入的某个节点，能否在**规则**、**其他组成员**、**`underlying-proxy=`** 中按名称直接引用？ |
| 怎么查 | 实测：`policy-path` 内容中有节点 `A`，主配置写 `DOMAIN,example.com,A` 和 `X = ss, ..., underlying-proxy=A`，看加载结果 |
| 影响 | "否" → 沿用包装组方案：`__ref = select, policy-path=..., policy-regex-filter=^A$, hidden=true`（06 §5-2）；"是" → 直接写名称，省掉包装组 |
| 采集结果 | |

### S3 · 外部节点能否引用主配置（代理链落地侧）

| | |
| --- | --- |
| 问题 | `policy-path` 内容中的节点写 `underlying-proxy=<主配置中的组或节点名>`，是否生效？ |
| 怎么查 | 实测：主配置有组 `Relay`，`policy-path` 内容中节点带 `underlying-proxy=Relay`；用 Surge 的请求查看器确认流量经过 Relay |
| 影响 | "是" → 和 mihomo 一样，落地留在外部节点集，由我们按 Profile 生成专属内容；"否" → Surge 下凡是要走代理链的落地节点，都必须内联到 `[Proxy]`（PRD REF-05 策略③），并影响 Q9 |
| 采集结果 | |

### S4 · `underlying-proxy` 能否指向策略组

| | |
| --- | --- |
| 问题 | `underlying-proxy=` 的值能否是策略组（而不只是节点）？ |
| 怎么查 | 手册"代理"页的 underlying-proxy 说明；实测 |
| 影响 | "否" → Surge 不支持 PRD REF-12（"前置是可切换的组"），UI 中要按客户端提示，Surge 下只能选固定节点 |
| 采集结果 | |

### S5 · 空组与筛空的行为

| | |
| --- | --- |
| 问题 | ① 没有成员的 select 组能否加载；② `policy-regex-filter` 一个节点都筛不出来时，组的行为是什么（报错 / 视为 DIRECT / 不可用）？ |
| 怎么查 | 实测两种情况，看主界面和请求结果 |
| 影响 | ① 决定 TPL-10 的 Surge 写法（现行假设 `select, DIRECT`）；② 若筛空时回退 DIRECT，包装组存在"静默直连"风险，需要找到等价于 mihomo `empty-fallback: REJECT` 的写法，否则在 UI 中给出风险提示 |
| 采集结果 | |

### S6 · 策略组参数全集

| | |
| --- | --- |
| 问题 | 以下参数是否存在、确切名称和取值：`policy-regex-filter`、`include-all-proxies`、`include-other-group`、`hidden`、`no-alert`、`url`、`interval`、`timeout`、`tolerance`、`evaluate-before-use`、图标参数（`icon-url`？）；是否有 load-balance 组以及它的策略参数 |
| 怎么查 | 手册"策略组"页，逐项摘录 |
| 影响 | 填写 04 §2 映射表；不存在的参数在 Surge 输出时忽略并写入渲染报告 |
| 采集结果 | |

### S7 · 进程规则

| | |
| --- | --- |
| 问题 | ① `PROCESS-NAME` 能否写完整路径；② 是否支持 `*` `?` 通配（写名称时、写路径时分别）；③ iOS 上是否完全不可用 |
| 怎么查 | 手册"规则"页；macOS 上实测 `PROCESS-NAME,/Applications/*/Contents/MacOS/*` |
| 影响 | 04 §3.2 映射表：通配不支持时，`*-WILDCARD` 在 Surge 下丢弃并告警，而不是转换 |
| 采集结果 | |

### S8 · 其他规则类型

| | |
| --- | --- |
| 问题 | 是否支持：`DOMAIN-WILDCARD`、`DOMAIN-REGEX`、`IP-ASN`、`GEOIP`；网络协议规则的名称（`PROTOCOL`？）；源 IP / 目标端口的写法（`SRC-IP`、`DEST-PORT`）；`extended-matching` 参数；逻辑规则 `AND`/`OR`/`NOT` 的语法 |
| 怎么查 | 手册"规则"各页 |
| 影响 | 填写 04 §3.1；不支持的类型在 Surge 输出时丢弃并告警 |
| 采集结果 | |

### S9 · RULE-SET 与 DOMAIN-SET

| | |
| --- | --- |
| 问题 | ① 两者文件格式的差异；② DOMAIN-SET 中 `.example.com`（前导点）与 `example.com` 的语义；③ RULE-SET 内能否包含 `PROCESS-NAME`、逻辑规则 |
| 怎么查 | 手册"规则集"页 |
| 影响 | 04 §3.3 的格式转换规则；规则仓库（08）中 Surge 变体的选择 |
| 采集结果 | |

### S10 · DNS 与通用设置

| | |
| --- | --- |
| 问题 | ① `[Host]` 能否按域名指定 DNS 服务器（写法？）；② `[General]` 中 DNS 相关参数的确切名称（`dns-server`、`encrypted-dns-server`、`always-real-ip`、`hijack-dns`）；③ 测试地址参数（`internet-test-url`、`proxy-test-url`、`test-timeout`） |
| 怎么查 | 手册 General / Host 页 |
| 影响 | 04 §4 映射表、PRD BS-02 |
| 采集结果 | |

### S11 · 协议支持

| | |
| --- | --- |
| 问题 | 当前版本支持哪些代理协议：ss、vmess、trojan、snell、tuic（v5？）、hysteria2、wireguard、vless、reality、anytls、ssh 等 |
| 怎么查 | 手册"代理"页 |
| 影响 | Surge 输出时不支持的节点被丢弃并写入报告；节点集预览中按客户端标注"不可用" |
| 采集结果 | |

### S12 · 托管配置与 UA

| | |
| --- | --- |
| 问题 | ① `#!MANAGED-CONFIG <url> interval=... strict=...` 的写法；② Surge iOS 与 macOS 拉取订阅时的 User-Agent 原文 |
| 怎么查 | 手册托管配置页；在本地起一个简单 HTTP 服务，让 Surge 拉取，记录请求头 |
| 影响 | 订阅输出的首行；CR-04 客户端识别 |
| 采集结果 | |

---

## 2. mihomo 实测

源码结论见 06。需要本地运行 mihomo 二进制验证。建议环境：起 2 个 socks5 服务分别扮演"前置"和"落地"（可以就用 mihomo 的 `listeners` 起），再起一个本地 HTTP 服务作为访问目标；观察"前置"入站的连接日志。

| # | 问题 | 怎么测 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| M1 | 前置在 provider、落地在本地：包装组方案是否可用 | 本地落地节点 `dialer-proxy: __ref`；`__ref` 为 `use: [P]` + `filter: ^前置$` 的 select 组 | 06 场景 1 | |
| M2 | 落地在 provider、前置在本地：provider 内容中写 `dialer-proxy: <本地节点或组>` 是否生效 | `type: file` provider 指向手写文件 | 06 场景 2/3（核心假设） | |
| M3 | 两端都在 provider（同源、异源各测一次） | 组合 M1 + M2 | 06 场景 5 | |
| M4 | `override.dialer-proxy: <组名>` 整源走前置 | provider 配置 override | 06 §2.1 | |
| M5 | 包装组筛空 + `empty-fallback: REJECT` 是否拒绝连接 | 把 filter 改成不存在的名称 | REF-10（防泄漏） | |
| M6 | provider 内 `dialer-proxy` 写一个不存在的名称：`-t` 是否仍通过、运行时报什么 | `mihomo -t -d . -f config.yaml` + 实际请求 | REF-08（服务端校验必要性） | |
| M7 | 主配置中只有 `proxies: [COMPATIBLE]` 的组能否加载、面板如何显示 | `-t` + 打开面板 | TPL-10 | |
| M8 | http provider 的 URL 只改 `?v=` 参数，重载主配置后是否重新下载 | 观察 provider 缓存目录与请求日志 | REF-11 | |
| M9 | `hidden: true` 的组在 Clash Verge Rev / FlClash / Zashboard / MetaCubeXD 中是否隐藏 | 逐个面板截图 | 包装组对用户是否可见 | |
| M10 | `PROCESS-*-WILDCARD`、`DOMAIN-WILDCARD`、`empty-fallback` 分别从哪个版本开始支持 | 查 release notes / CHANGELOG | 是否需要按内核版本降级输出 | |

---

## 3. mihomo 系客户端：FlClash / Clash Verge Rev / ClashMetaForAndroid

| # | 问题 | 怎么查 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| C1 | 拉取订阅时的 User-Agent 原文（Windows / macOS / Android 各一条）；能否从中区分平台 | 本地 HTTP 服务记录请求头 | CR-04 客户端与平台识别 | |
| C2 | 当前内置的 mihomo 内核版本 | 客户端"关于"页 | 结合 M10 决定可用字段 | |
| C3 | 是否会改写或忽略订阅中的 `proxy-providers`、`rule-providers`、`hidden`、`empty-fallback` | 导入测试配置后查看客户端生成的运行配置 | 包装组 / provider 方案在该客户端是否成立 | |
| C4 | 是否读取响应头 `subscription-userinfo`、`profile-update-interval`、`content-disposition`（文件名） | 本地 HTTP 服务返回这些头，观察客户端显示 | SRC-05 流量信息、订阅显示名 | |
| C5 | Android 上 `PROCESS-NAME` 匹配的是包名还是进程名 | 写一条包名规则实测 | CR-02 平台覆盖的典型用例 | |
| C6 | 是否支持 `mrs` 格式的 rule-provider | 实测 | 规则仓库（08）中 mihomo 默认是否选 mrs | |

---

## 4. Loon（P2，预留，不阻塞首期）

参考入口：Loon 官方文档 / 示例配置。

| # | 问题 | 采集结果 |
| --- | --- | --- |
| L1 | 外部节点（`[Remote Proxy]`）的写法，策略组如何引用外部节点、如何按正则筛选 | |
| L2 | 代理链写法（是否为独立的 `[Proxy Chain]` 段；妙妙屋 `internal/handler/loon_template.go` 中有实现可参考思路） | |
| L3 | 外部节点能否作为链的前置 / 落地（对应 S2、S3） | |
| L4 | 远程规则集 `[Remote Rule]` 的格式；是否支持进程规则 | |
| L5 | UA 原文 | |

## 5. Stash（P2，预留，不阻塞首期）

| # | 问题 | 采集结果 |
| --- | --- | --- |
| T1 | 对 Clash 配置的兼容范围：`proxy-providers`、`rule-providers`（behavior / format，是否支持 mrs） | |
| T2 | 链式代理写法（`dialer-proxy` 还是其他字段），provider 中的节点能否引用主配置（对应 M2） | |
| T3 | 组字段支持：`use`、`filter`、`include-all`、`hidden`、`empty-fallback` | |
| T4 | macOS 版是否支持进程规则、写法 | |
| T5 | UA 原文 | |

## 6. 规则仓库（见 08）

| # | 问题 | 怎么查 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| F1 | blackmatrix7 README "使用说明 / 配置建议"有哪些措辞模板（"单独使用"、"共同使用"之外还有吗） | 抽查 Clash / Surge 目录下 20 个 README，尤其是有 `_Classical`、`_Domain`、`_IP` 变体的 | 适配器解析规则 | |
| F2 | zydou 的 `@attr` 命名含义：`cn@!cn`、`cn@-!cn` 分别对应 v2fly 的什么 | 对照 v2fly/domain-list-community 的属性说明与转换脚本 | 搜索结果中属性的展示文案 | |
| F3 | 带尾部空格的文件名（`openai@ads .txt`）是否为上游构建 bug，内容与无空格版是否相同 | 对比两个文件 | 索引时去重还是丢弃 | |
| F4 | jsDelivr 访问这两个仓库是否可用、缓存延迟多久；国内网络下 raw.githubusercontent.com 的可达性 | 实测 | REPO-07 默认 `urlTemplate` | |

---

## 7. 采集完成后需要决策的问题

以下问题**等采集完成后统一决定**，届时把结论回填到 05 §3.1：

| # | 问题 | 依赖的采集项 |
| --- | --- | --- |
| Q5 | 模板组之间的引用是否属于模板 | 无（产品决策） |
| Q6 | Profile 能否删除 / 改名模板中的组 | 无（产品决策） |
| Q8 | 普通用户能否编写脚本处理器 | 无（产品决策） |
| Q9 | Surge 输出中外部节点集：`policy-path` 还是内联 | S1、S2、S3、S5 |
| Q10 | 项目名 | 无 |
| R1 | 规则仓库默认引用模式：直连还是托管 | C6、F4 |
| R2 | 托管再分发 GPL-2.0 规则内容的合规方式 | 无（法律判断） |
| R3 | mihomo 默认选 mrs 还是 yaml | C6、M10 |
| R4 | 普通用户能否添加自定义仓库 | 无（产品决策） |
| D1 | Surge 是否支持"前置为可切换的组"（REF-12） | S4 |
| D2 | Surge 包装组的防泄漏方案 | S5 |
| D3 | 是否需要按 mihomo 内核版本降级输出 | M10、C2 |

## 8. 决策记录

（采集完成后填写）
