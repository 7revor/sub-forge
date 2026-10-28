# 07 · 待核对清单（本地采集用）

> **状态：第一轮采集完成（2026-10-28），剩余项需要 GUI 或真机配合。**
> 已完成：Surge 手册全部相关页面、`surge-cli --check` 离线校验（Surge Mac 6.9.1）、mihomo v1.19.33 代理链实测、mihomo 源码版本追溯、规则仓库 F1–F4。
> 未完成的项在各表中标为 **⏳**，汇总见 [§7.1](#71-剩余采集项)。全部采集完成前，依赖这些结论的设计（标注 ⚠ 的位置）保持草案状态，不进入实现。
> 实测用例可复现：[research/verification/](../research/verification/README.md)。

## 0. 怎么填写

每一项都包含：

- **问题**：要回答的具体问题（尽量是是/否或枚举）；
- **怎么查**：文档页面或实测步骤；
- **影响**：答案为"是"或"否"时，设计分别怎么走；
- **采集结果**：填原文摘录、截图路径或实测输出（**只记录事实，不做决定**）。

全部采集完后，在 §8 汇总决策。

---

## 1. Surge

参考入口：<https://manual.nssurge.com/>（手册已改版，页面路径为 `policy-groups/*.html`、`policies/*.html`、`rules/*.html`、`profile/managed-profile.html`、`dns/*.html`）。
本机 Surge Mac 6.9.1。离线校验工具：`/Applications/Surge.app/Contents/Applications/surge-cli --check <profile>`。

> **离线校验的局限**：`--check` 不解析 `policy-path` 外部内容；对**组成员**中不存在的名称不报错（对照用例 `G = select, NOPE` 也通过），对组级 `underlying-proxy=` 指向不存在的名称也不报错。规则目标和节点级 `underlying-proxy` 会校验。

### S1 · 外部节点集：`policy-path`

| | |
| --- | --- |
| 问题 | ① 组参数 `policy-path=<url>` 的确切写法；② URL 返回的内容格式（`[Proxy]` 段的逐行 `name = type, ...`？还是需要整段带标题？）；③ 更新间隔参数名（`update-interval`？）；④ 一个组能否写**多个** `policy-path` |
| 怎么查 | 手册"策略组"页；实测：建一个组带两个 `policy-path` 看是否报错 |
| 影响 | ④ 为"否" → 一个组含多个节点集时，渲染层为每个节点集生成隐藏子组，再在父组用 `include-other-group` 合并（04 §2 现行方案）；为"是" → 直接写多个 |
| 采集结果 | ① `egroup = select, policy-path=proxies.txt`，值为本地路径或 URL（`policy-groups/policy-including.html`）。<br>② 两种都接受："A policy list: one policy line per line, in the same format as the [Proxy] section. Blank lines and lines starting with # or // are ignored. Invalid lines are logged and skipped; policies whose names duplicate an existing policy are skipped with a warning." 或 "A complete Surge profile: if the content contains a [Proxy] section, the policies in that section are used."<br>③ `update-interval`，秒，默认 86400，仅对 URL 有意义。<br>④ 手册未提及多个 `policy-path`。离线校验：两个 `policy-path` 的组 **通过**（`s1multi.conf`），但离线校验不解析外部内容，**两个是否都生效 ⏳ 需运行时确认**。手册明确支持的替代：`include-other-group="g1,g2"`（引号包裹、逗号分隔、递归展开，校验通过 `i1.conf`）。<br>其他相关参数：`policy-regex-filter`（作用于 policy-path / include-all-proxies / include-other-group，不作用于显式列出的成员）、`external-policy-modifier="k=v,..."`、`external-policy-name-prefix`；处理顺序 filter → prefix → modifier。成员组装顺序：显式成员 → include-other-group → include-all-proxies → policy-path，重名保留第一个 |

### S2 · 外部节点能否按名称被引用（代理链前置侧）

| | |
| --- | --- |
| 问题 | `policy-path` 引入的某个节点，能否在**规则**、**其他组成员**、**`underlying-proxy=`** 中按名称直接引用？ |
| 怎么查 | 实测：`policy-path` 内容中有节点 `A`，主配置写 `DOMAIN,example.com,A` 和 `X = ss, ..., underlying-proxy=A`，看加载结果 |
| 影响 | "否" → 沿用包装组方案：`__ref = select, policy-path=..., policy-regex-filter=^A$, hidden=true`（06 §5-2）；"是" → 直接写名称，省掉包装组 |
| 采集结果 | **规则**：否。`DOMAIN,example.com,A` → `Rule #0 include an unknown policy name: A`（`s2rule.conf`）。<br>**`underlying-proxy=`**：否。`Relay = socks5, ..., underlying-proxy=A` → `Proxy Relay used an unknown underlying proxy: A`（`s2under.conf`）。<br>**组成员**：离线校验通过（`s2member.conf`），但离线校验对任何未知成员名都不报错，**⏳ 无法据此判断，需运行时确认**。<br>包装组写法 `Ref = select, policy-path=..., policy-regex-filter=^A$, hidden=true` + `X = ..., underlying-proxy=Ref` 校验通过（`w4.conf`） |

### S3 · 外部节点能否引用主配置（代理链落地侧）

| | |
| --- | --- |
| 问题 | `policy-path` 内容中的节点写 `underlying-proxy=<主配置中的组或节点名>`，是否生效？ |
| 怎么查 | 实测：主配置有组 `Relay`，`policy-path` 内容中节点带 `underlying-proxy=Relay`；用 Surge 的请求查看器确认流量经过 Relay |
| 影响 | "是" → 和 mihomo 一样，落地留在外部节点集，由我们按 Profile 生成专属内容；"否" → Surge 下凡是要走代理链的落地节点，都必须内联到 `[Proxy]`（PRD REF-05 策略③），并影响 Q9 |
| 采集结果 | 原问题手册未直接说明，离线校验不解析外部内容（`s3.conf` 通过但无意义），**⏳ 需运行时确认**。<br>**新发现——组级 `underlying-proxy`**（iOS 5.22.0+ / Mac 6.9.0+，`policy-groups/parameters.html`）："Set up a proxy chain for the whole group: every proxy member connects through the given policy … It applies to members from every source — explicitly listed members, policy-path, include-all-proxies, and include-other-group"。要点：<br>· 受影响的成员显示为派生策略 `Name (via Relay)`，有独立的测速结果和流量统计；<br>· 成员本身是组时不受影响（嵌套组可自行声明）；DIRECT / REJECT 原样通过；<br>· 成员自带的 `underlying-proxy` 会被组级值覆盖；<br>· 只给部分成员加链：手册建议包一层嵌套组，"No copy of the policy declaration is needed"：`NodeB-Chained = select, NodeB, underlying-proxy=Relay`；<br>· 旧写法 `external-policy-modifier="underlying-proxy=Relay"` 仍可用，但只覆盖 policy-path 成员、无 UI、改后名称不变；两者并存时组级优先。<br>离线校验：`G = select, policy-path=..., policy-regex-filter=^B$, underlying-proxy=RelayG, hidden=true` 通过（`w1.conf`）；组级 `underlying-proxy` 指向自身报 `The value of underlying-proxy is invalid`（`w2.conf`）；指向不存在的名称离线不报错（`w3.conf`，手册称运行时会明确报告） |

### S4 · `underlying-proxy` 能否指向策略组

| | |
| --- | --- |
| 问题 | `underlying-proxy=` 的值能否是策略组（而不只是节点）？ |
| 怎么查 | 手册"代理"页的 underlying-proxy 说明；实测 |
| 影响 | "否" → Surge 不支持 PRD REF-12（"前置是可切换的组"），UI 中要按客户端提示，Surge 下只能选固定节点 |
| 采集结果 | **是**。`policies/parameters.html`："Optional, the name of another proxy policy or policy group. Proxy policies only." / "The value may also be a policy group name, so the entry node can be selected dynamically." 组级 `underlying-proxy` 同样接受组名（`w1.conf` 通过）。限制："underlying-proxy cannot be combined with the port-hopping parameter of QUIC-based protocols"；配置了前置时节点的 `ip-version` 无效 |

### S5 · 空组与筛空的行为

| | |
| --- | --- |
| 问题 | ① 没有成员的 select 组能否加载；② `policy-regex-filter` 一个节点都筛不出来时，组的行为是什么（报错 / 视为 DIRECT / 不可用）？ |
| 怎么查 | 实测两种情况，看主界面和请求结果 |
| 影响 | ① 决定 TPL-10 的 Surge 写法（现行假设 `select, DIRECT`）；② 若筛空时回退 DIRECT，包装组存在"静默直连"风险，需要找到等价于 mihomo `empty-fallback: REJECT` 的写法，否则在 UI 中给出风险提示 |
| 采集结果 | ① `E = select`（无成员、无参数）→ `Invalid line: E = select`（`s5empty.conf`）。`select, DIRECT`、`select, REJECT` 通过；**`select, hidden=true`（无成员但有参数）也通过**（`e1`–`e3.conf`），运行时表现 ⏳。<br>② 手册 `policy-groups/overview.html`："If a group ends up with no usable member at all, Surge falls back to DIRECT (shown as SUBSTITUTE in logs) and raises a one-time warning." → **筛空回退 DIRECT，存在静默直连风险**。筛空的组离线校验通过（`s5filter.conf`）。<br>补充：fallback 组 "If no member qualifies, the first member is used regardless"；load-balance 组 "If no member is currently available, all members are used as candidates"；组引用成环时该组 "temporarily behaves as a reject policy (shown as FAILED)"。<br>候选防泄漏写法 `Inner = select, policy-path=..., policy-regex-filter=^X$, hidden=true` + `G = fallback, Inner, REJECT` 离线校验通过（`f1.conf`），**⏳ 运行时是否拒绝连接待测**（疑点：Inner 回退 DIRECT 后可能被 fallback 判定为可用） |

### S6 · 策略组参数全集

| | |
| --- | --- |
| 问题 | 以下参数是否存在、确切名称和取值：`policy-regex-filter`、`include-all-proxies`、`include-other-group`、`hidden`、`no-alert`、`url`、`interval`、`timeout`、`tolerance`、`evaluate-before-use`、图标参数（`icon-url`？）；是否有 load-balance 组以及它的策略参数 |
| 怎么查 | 手册"策略组"页，逐项摘录 |
| 影响 | 填写 04 §2 映射表；不存在的参数在 Surge 输出时忽略并写入渲染报告 |
| 采集结果 | 组类型：`select`、`url-test`、`fallback`、`load-balance`、`smart`、`subnet`（`ssid` 为旧别名）。`smart` 会静默忽略嵌套组和内置策略成员。<br>**通用参数**（subnet 组只支持 hidden / icon-url / category）：<br>· `hidden`：布尔，默认 false<br>· `no-alert`：布尔，只对 url-test / fallback 有效<br>· `icon-url`：Mac 6.5.0+，"needs to be edited manually in the profile"<br>· `category`：iOS 5.23.0+ / Mac 6.10.0+，仅影响展示分类<br>· `underlying-proxy`：iOS 5.22.0+ / Mac 6.9.0+（见 S3）<br>**引入成员**：`policy-path`、`update-interval`、`policy-regex-filter`、`external-policy-modifier`、`external-policy-name-prefix`、`include-all-proxies=true`（iOS 4.12.0+ / Mac 4.5.0+，只含 `[Proxy]` 中的代理，不含内置策略和组）、`include-other-group="g1,g2"`<br>**测速参数**（url-test / fallback / load-balance）：<br>· `interval`：**秒**，默认 600，表示结果有效期，过期后"被使用时"才重测（懒测速）<br>· `timeout`：**秒**，无默认值，是**按延迟筛选候选**，不是单次测速超时（单次超时是节点级 `test-timeout` 或 `[General] test-timeout`，默认 5 秒）<br>· `tolerance`：毫秒，默认 100，仅 url-test<br>· `evaluate-before-use`：布尔，默认 false<br>· **组级 `url` 已无效**："The legacy url = parameter on a group line has no effect in current versions." 测速地址改用节点级 `test-url` 或 `[General] proxy-test-url`<br>**load-balance**：存在，参数 `persistent`（布尔，默认 false；为 true 时按目标主机名哈希选节点）；测速参数同上；从不发通知 |

### S7 · 进程规则

| | |
| --- | --- |
| 问题 | ① `PROCESS-NAME` 能否写完整路径；② 是否支持 `*` `?` 通配（写名称时、写路径时分别）；③ iOS 上是否完全不可用 |
| 怎么查 | 手册"规则"页；macOS 上实测 `PROCESS-NAME,/Applications/*/Contents/MacOS/*` |
| 影响 | 04 §3.2 映射表：通配不支持时，`*-WILDCARD` 在 Surge 下丢弃并告警，而不是转换 |
| 采集结果 | `rules/process.html`：<br>① 能。值以 `/` 开头（且不以 `/` 结尾）为**完整路径模式**。<br>② 名称模式、完整路径模式**都支持 `*` 和 `?`**；另有 **App Bundle 模式**（Mac 6.0.0+）：以 `/` 开头且以 `/` 结尾，按路径前缀匹配，如 `PROCESS-NAME,/Applications/ChatGPT.app/`。所有模式**区分大小写**。不支持 `pre-matching`。<br>③ "Process rules are available on Surge Mac only; Surge iOS ignores these rules."（忽略而不是报错）<br>离线校验：`PROCESS-NAME,/Applications/*/Contents/MacOS/*,DIRECT` 通过（`rules.conf`） |

### S8 · 其他规则类型

| | |
| --- | --- |
| 问题 | 是否支持：`DOMAIN-WILDCARD`、`DOMAIN-REGEX`、`IP-ASN`、`GEOIP`；网络协议规则的名称（`PROTOCOL`？）；源 IP / 目标端口的写法（`SRC-IP`、`DEST-PORT`）；`extended-matching` 参数；逻辑规则 `AND`/`OR`/`NOT` 的语法 |
| 怎么查 | 手册"规则"各页 |
| 影响 | 填写 04 §3.1；不支持的类型在 Surge 输出时丢弃并告警 |
| 采集结果 | · `DOMAIN-WILDCARD`：支持。`*` 匹配任意字符**且跨越点号**（`*.example.com` 匹配 `a.b.example.com`），`?` 单字符，支持 `[...]` 字符类，不区分大小写<br>· `DOMAIN-REGEX`：**不支持**，规则类型索引中没有；离线校验报无效行（`rules.conf`）。只有 HTTP 类的 `URL-REGEX`<br>· `IP-ASN`：支持，十进制或带 `AS` 前缀；`GEOIP`：支持，ISO 国家代码不区分大小写；二者都可写 `UNKNOWN`（iOS 5.102.0+ / Mac 6.9.1+）<br>· `PROTOCOL`：值为 `HTTP`、`HTTPS`、`TCP`、`UDP`、`QUIC`、`STUN`、`MTProto`、`DOH`、`DOH3`、`DOQ`、`DOT`、`DNS`，**区分大小写**；`TCP` 同时匹配 HTTP/HTTPS/MTProto，`UDP` 同时匹配 QUIC/STUN<br>· 源与端口：`SRC-IP`（支持 CIDR）、`DEST-PORT`、`SRC-PORT`、`IN-PORT`；端口值可为单个、闭区间 `10000-20000`、或 `>` `<` `>=` `<=`（iOS 5.8.4+ / Mac 5.4.4+）<br>· 其他：`USER-AGENT`、`HOSTNAME-TYPE`（Mac 5.7.3+）、`SUBNET`、`DEVICE-NAME`、`MAC-ADDRESS`（Mac 6.1.0+）、`CELLULAR-RADIO` / `CELLULAR-CARRIER`（iOS）、`SCRIPT`<br>· `extended-matching`：标记参数，适用于 DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / DOMAIN-WILDCARD / URL-REGEX / RULE-SET / DOMAIN-SET，额外匹配 TLS SNI 和 HTTP Host（iOS 5.8.0+ / Mac 5.4.0+）<br>· 逻辑规则：`AND,((Rule1),(Rule2),...),Policy`、`OR,(...)`、`NOT,((Rule1)),Policy`（NOT 只能一个子规则）；子规则不带策略，可嵌套，最大深度 10；子规则可以是 RULE-SET 和 SCRIPT，不能是 FINAL<br>· 未知的规则参数被静默忽略；规则列表必须以 `FINAL` 结尾 |

### S9 · RULE-SET 与 DOMAIN-SET

| | |
| --- | --- |
| 问题 | ① 两者文件格式的差异；② DOMAIN-SET 中 `.example.com`（前导点）与 `example.com` 的语义；③ RULE-SET 内能否包含 `PROCESS-NAME`、逻辑规则 |
| 怎么查 | 手册"规则集"页 |
| 影响 | 04 §3.3 的格式转换规则；规则仓库（08）中 Surge 变体的选择 |
| 采集结果 | ① DOMAIN-SET：每行一个主机名，`#` 或 `//` 开头为注释，只能匹配域名，为大列表优化。RULE-SET：每行一条不带策略的规则，`#`、`//`、`;` 为注释，可带行内 `no-resolve` / `extended-matching`，**不允许 `FINAL` 和 `pre-matching`**。两者都是无效行跳过并告警、上限 100 万条；**同一 URL 不能在一份配置中同时用作 RULE-SET 和 DOMAIN-SET**。<br>② `example.com` = 精确匹配（同 DOMAIN）；`.example.com` = 自身及全部子域名（同 DOMAIN-SUFFIX）。<br>③ PROCESS-NAME：可以——内置 `SYSTEM` 规则集本身就含 `PROCESS-NAME,trustd`。逻辑规则：手册写 "Any rule type that is valid inside a rule set can be used as a sub-rule"，未明确说逻辑规则能否出现在规则集中，⏳ 可用 `surge-cli lsp` 或运行时验证。<br>其他：内联规则集 `[Ruleset <name>]`（Mac 5.3.1+）；内联规则集可嵌套 RULE-SET / DOMAIN-SET（iOS 5.22.0+ / Mac 6.9.0+，最多 8 层）；RULE-SET 行上的 `update-interval=<秒>`（默认 86400，负数表示不自动更新）；内置 `SYSTEM`、`LAN` |

### S10 · DNS 与通用设置

| | |
| --- | --- |
| 问题 | ① `[Host]` 能否按域名指定 DNS 服务器（写法？）；② `[General]` 中 DNS 相关参数的确切名称（`dns-server`、`encrypted-dns-server`、`always-real-ip`、`hijack-dns`）；③ 测试地址参数（`internet-test-url`、`proxy-test-url`、`test-timeout`） |
| 怎么查 | 手册 General / Host 页 |
| 影响 | 04 §4 映射表、PRD BS-02 |
| 采集结果 | ① 能。`example.com = server:8.8.8.8`；值可为 `ip[:port]` 或加密 DNS URL；多个服务器用逗号（iOS 5.21.0+ / Mac 6.8.0+）；`server:system`；支持 `*` `?` 通配（`*google.com` 是纯字符串匹配，也会匹配 `bargoogle.com`）；可绑定整个规则集：`DOMAIN-SET:<url> = server:...`、`RULE-SET:<url> = ...`（Mac 5.10.0+，只有域名类条目生效）。代理服务器自身的主机名不会匹配 `[Host]`。<br>② 四个参数名都正确：`dns-server`（逗号分隔 IP，或 `system`；写了加密 DNS URL 会被自动移到 `encrypted-dns-server`）、`encrypted-dns-server`、`hijack-dns`（如 `*:53`）、`always-real-ip`（Host List 类型）。<br>③ `internet-test-url`（默认 `http://bing.com/`，也是 DIRECT 的测速地址）、`proxy-test-url`（默认 `http://bing.com/`；HTTPS 需 iOS 5.23.0+ / Mac 6.10.0+）、`test-timeout`（秒，默认 5；DIRECT 测试用 10 秒）。节点级可用 `test-url`、`test-timeout`、`test-udp` 覆盖 |

### S11 · 协议支持

| | |
| --- | --- |
| 问题 | 当前版本支持哪些代理协议：ss、vmess、trojan、snell、tuic（v5？）、hysteria2、wireguard、vless、reality、anytls、ssh 等 |
| 怎么查 | 手册"代理"页 |
| 影响 | Surge 输出时不支持的节点被丢弃并写入报告；节点集预览中按客户端标注"不可用" |
| 采集结果 | `policies/overview.html` 列表：`http` / `https`、`h2-connect`（Mac 6.6.0+）、`socks5` / `socks5-tls`、`ss`、`snell`（v1–6）、`vmess`、`trojan`、`tuic` / `tuic-v5`、`hysteria2`（iOS 5.8.0+ / Mac 5.4.0+）、`masque`（iOS 5.22.0+ / Mac 6.9.0+）、`anytls`（iOS 5.17.0+ / Mac 6.4.3+）、`trust-tunnel`（Mac 6.4.4+）、`ssh`、`wireguard`、`tailscale`（iOS 5.20.0+ / Mac 6.7.0+）、`external`（仅 Mac，iOS 上视为 REJECT）。<br>**不支持 vless / reality**：离线校验 `V = vless, ...` → `Unknown proxy type: vless`（`vless.conf`）。hysteria（v1）也不在列表中 |

### S12 · 托管配置与 UA

| | |
| --- | --- |
| 问题 | ① `#!MANAGED-CONFIG <url> interval=... strict=...` 的写法；② Surge iOS 与 macOS 拉取订阅时的 User-Agent 原文 |
| 怎么查 | 手册托管配置页；在本地起一个简单 HTTP 服务，让 Surge 拉取，记录请求头 |
| 影响 | 订阅输出的首行；CR-04 客户端识别 |
| 采集结果 | ① `#!MANAGED-CONFIG http://test.com/surge.conf interval=60 strict=true`；`interval` 秒，默认 86400，是"最短间隔"；`strict` 默认 false，为 true 时到期必须更新成功。**新下发的配置也必须带这一行**，否则退化为普通配置。只有 Surge 主程序运行时才会更新。<br>相关：`!REQUIREMENT` 语句可按平台 / 版本启用某一行（`#!REQUIREMENT CORE_VERSION>=22 Group = smart, ...` 或行尾 `//!REQUIREMENT ...`），另有 `#!IOS-ONLY`、`#!MACOS-ONLY`；`#!FORBIDDEN-AUTO-UPGRADE smart-group` 阻止把 url-test / load-balance 自动升级为 smart。<br>② ⏳ 待采集 |

---

## 2. mihomo 实测

源码结论见 06。测试环境：mihomo v1.19.33 darwin-arm64；"前置" socks5 127.0.0.1:17001、"落地" socks5 127.0.0.1:17002（各为独立 mihomo 实例，用 `listeners` 起）、HTTP 目标 127.0.0.1:17080；客户端 `MATCH` 到被测出口。判读方法：前置日志出现 `--> 127.0.0.1:17002` 且落地日志出现 `--> 127.0.0.1:17080` 即链路生效。用例见 [research/verification/mihomo](../research/verification/mihomo/)。

| # | 问题 | 怎么测 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| M1 | 前置在 provider、落地在本地：包装组方案是否可用 | 本地落地节点 `dialer-proxy: __ref`；`__ref` 为 `use: [P]` + `filter: ^前置$` 的 select 组 | 06 场景 1 | **可用**。`-t` 通过，请求 200，前置与落地日志均有记录（用例 m1）。API 返回 `__ref` 的 `hidden: true`、`all: [前置]` |
| M2 | 落地在 provider、前置在本地：provider 内容中写 `dialer-proxy: <本地节点或组>` 是否生效 | `type: file` provider 指向手写文件 | 06 场景 2/3（核心假设） | **生效**。指向本地节点（m2a）、本地 select 组（m2b）都经过前置 |
| M3 | 两端都在 provider（同源、异源各测一次） | 组合 M1 + M2 | 06 场景 5 | · **同源、直接写前置名称：失败**（m3a）。`-t` 通过，运行时每次连接报 `connect error: proxyName[前置] not found`——即便前置和落地在同一个 provider 里，provider 节点名也不在顶层表中<br>· **异源、直接写另一 provider 的节点名：失败**（m3c），报错同上<br>· **异源、`dialer-proxy` 指向包装组：成功**（m3b）<br>→ 证实 06 规则二：前置在 provider 时，不论同源异源都必须经包装组 |
| M4 | `override.dialer-proxy: <组名>` 整源走前置 | provider 配置 override | 06 §2.1 | **生效**（m4），provider 内容不含 `dialer-proxy`，经过前置 |
| M5 | 包装组筛空 + `empty-fallback: REJECT` 是否拒绝连接 | 把 filter 改成不存在的名称 | REF-10（防泄漏） | **拒绝**（m5a）：curl 失败，客户端日志 `dial 落地 ... error: EOF`，前置、落地都无连接。<br>**对照（不写 `empty-fallback`，m5b）：泄漏已复现**——请求 200，落地日志有连接、前置日志**没有**，即落地绕过前置直连 |
| M6 | provider 内 `dialer-proxy` 写一个不存在的名称：`-t` 是否仍通过、运行时报什么 | `mihomo -t -d . -f config.yaml` + 实际请求 | REF-08（服务端校验必要性） | `-t` **通过**；运行时每次连接失败：`connect error: proxyName[不存在的组] not found`（m6） |
| M7 | 主配置中只有 `proxies: [COMPATIBLE]` 的组能否加载、面板如何显示 | `-t` + 打开面板 | TPL-10 | `-t` 通过，可加载。**流量直连成功**（日志 `using Empty[COMPATIBLE]`，请求 200）——空组等效 DIRECT。API：`type: Selector`、`now: COMPATIBLE`、`all: [COMPATIBLE]`。面板显示 ⏳ |
| M8 | http provider 的 URL 只改 `?v=` 参数，重载主配置后是否重新下载 | 观察 provider 缓存目录与请求日志 | REF-11 | · **不写 `path`**：首次启动下载；同 URL 重启不下载（读缓存）；改为 `?v=2` 后 `PUT /configs?force=true` 热重载，**立即重新下载**<br>· **显式写 `path: ./providers/P.yaml`**：改为 `?v=2` 热重载后**没有重新下载**（缓存文件仍在 `interval` 内）<br>→ REF-11 的前提是 provider **不设 `path`**（或 path 随版本变化） |
| M9 | `hidden: true` 的组在 Clash Verge Rev / FlClash / Zashboard / MetaCubeXD 中是否隐藏 | 逐个面板截图 | 包装组对用户是否可见 | 内核 API 对包装组返回 `hidden: true`（M1）。各面板显示 ⏳ |
| M10 | `PROCESS-*-WILDCARD`、`DOMAIN-WILDCARD`、`empty-fallback` 分别从哪个版本开始支持 | 查 release notes / CHANGELOG | 是否需要按内核版本降级输出 | 方法：在 v1.16.0 起的各 tag 上二分查找源码中首次出现的位置（`constant/rule.go`、`adapter/outboundgroup/parser.go`、`constant/provider/interface.go`）。<br>· `empty-fallback`：**v1.19.27**<br>· `DOMAIN-WILDCARD`：**v1.19.12**<br>· `PROCESS-NAME-WILDCARD` / `PROCESS-PATH-WILDCARD`：**v1.19.19**<br>· mrs 格式 rule-provider：**v1.18.7**<br>· 组 `hidden`：**v1.18.1**<br>· 组 `include-all`：**v1.17.0** |

---

## 3. mihomo 系客户端：FlClash / Clash Verge Rev / ClashMetaForAndroid

| # | 问题 | 怎么查 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| C1 | 拉取订阅时的 User-Agent 原文（Windows / macOS / Android 各一条）；能否从中区分平台 | 本地 HTTP 服务记录请求头 | CR-04 客户端与平台识别 | ⏳ |
| C2 | 当前内置的 mihomo 内核版本 | 客户端"关于"页 | 结合 M10 决定可用字段 | macOS：Clash Verge Rev 2.5.8 → `verge-mihomo` v1.19.32（另带 `verge-mihomo-alpha` alpha-e4dd968）；FlClash 0.9.1 → `FlClashCore` v1.19.32（构建参数 `-X .../constant.Version=v1.19.32`）。两者都 ≥ v1.19.27，支持 M10 中全部字段。Windows / Android ⏳ |
| C3 | 是否会改写或忽略订阅中的 `proxy-providers`、`rule-providers`、`hidden`、`empty-fallback` | 导入测试配置后查看客户端生成的运行配置 | 包装组 / provider 方案在该客户端是否成立 | ⏳ |
| C4 | 是否读取响应头 `subscription-userinfo`、`profile-update-interval`、`content-disposition`（文件名） | 本地 HTTP 服务返回这些头，观察客户端显示 | SRC-05 流量信息、订阅显示名 | ⏳ |
| C5 | Android 上 `PROCESS-NAME` 匹配的是包名还是进程名 | 写一条包名规则实测 | CR-02 平台覆盖的典型用例 | ⏳ |
| C6 | 是否支持 `mrs` 格式的 rule-provider | 实测 | 规则仓库（08）中 mihomo 默认是否选 mrs | 按版本推断：macOS 两个客户端内核 v1.19.32 ≥ v1.18.7（M10），支持。导入实测与其他平台 ⏳ |

---

## 4. Loon（P2，预留，不阻塞首期）

参考入口：Loon 官方文档 / 示例配置。

| # | 问题 | 采集结果 |
| --- | --- | --- |
| L1 | 外部节点（`[Remote Proxy]`）的写法，策略组如何引用外部节点、如何按正则筛选 | ⏳ |
| L2 | 代理链写法（是否为独立的 `[Proxy Chain]` 段；妙妙屋 `internal/handler/loon_template.go` 中有实现可参考思路） | ⏳ |
| L3 | 外部节点能否作为链的前置 / 落地（对应 S2、S3） | ⏳ |
| L4 | 远程规则集 `[Remote Rule]` 的格式；是否支持进程规则 | ⏳ |
| L5 | UA 原文 | ⏳ |

## 5. Stash（P2，预留，不阻塞首期）

| # | 问题 | 采集结果 |
| --- | --- | --- |
| T1 | 对 Clash 配置的兼容范围：`proxy-providers`、`rule-providers`（behavior / format，是否支持 mrs） | ⏳ |
| T2 | 链式代理写法（`dialer-proxy` 还是其他字段），provider 中的节点能否引用主配置（对应 M2） | ⏳ |
| T3 | 组字段支持：`use`、`filter`、`include-all`、`hidden`、`empty-fallback` | ⏳ |
| T4 | macOS 版是否支持进程规则、写法 | ⏳ |
| T5 | UA 原文 | ⏳ |

## 6. 规则仓库（见 08）

| # | 问题 | 怎么查 | 影响 | 采集结果 |
| --- | --- | --- | --- | --- |
| F1 | blackmatrix7 README "使用说明 / 配置建议"有哪些措辞模板（"单独使用"、"共同使用"之外还有吗） | 抽查 Clash / Surge 目录下 20 个 README，尤其是有 `_Classical`、`_Domain`、`_IP` 变体的 | 适配器解析规则 | 抽查 20 个规则（Google、YouTube、Netflix、Apple、Microsoft、Telegram、OpenAI、China、ChinaMax、Global、Lan、Advertising、Twitter、Spotify、Steam、Bilibili、GitHub、Amazon、Disney、TikTok）× Clash / Surge，共 40 个 README。列表项句式（`X` 为文件名）：<br>· `X 单独使用。` / `X、Y 共同使用。` / `X、Y、Z 共同使用。`<br>· `X 纯IPv4网络，单独使用。` / `X、Y 纯IPv4网络，共同使用。`<br>· `X.yaml，请使用 behavior: "classical"` / `"domain"` / `"ipcidr"`<br>· `X.list，请使用RULE-SET。` / `X.list，请使用DOMAIN-SET。`<br>· `X与Y的区别仅在于后者IP-CIDR(6)类型带no-resolve。`<br>· `X与Y的区别在于后者不带IPv6规则，适用纯IPv4网络。`（及"不带IPv6类型的规则，且不带no-resolve"的变体）<br>· 版本分段：`Surge 5.21.0(2952)以上版本使用以下配置：` / `…以下版本使用以下配置：`，`X与Y为 Surge 5.21.0(2952) 以上版本使用`（见 Apple、Advertising、China、ChinaMax、Global 的 Surge README）<br>· 提示类：`URL-REGEX类型的规则，在HTTPS协议中，需要配合MITM使用。规则生成器已尝试推导MITM的配置X_MITM.sgmodule，仅供参考。`、`可能存在部分误拦截，建议搭配放行规则进行修正。`<br>README 中还有大量上游来源 URL 列表（LM-Firefly、ACL4SSR、Loyalsoldier 等），不是使用说明，解析时需跳过 |
| F2 | zydou 的 `@attr` 命名含义：`cn@!cn`、`cn@-!cn` 分别对应 v2fly 的什么 | 对照 v2fly/domain-list-community 的属性说明与转换脚本 | 搜索结果中属性的展示文案 | · `@!cn`：v2fly 中带 `!cn` 属性的条目。v2fly README："Rules with `@!cn` attribute have been cast out from cn lists"；`@cn` 的含义是 "Domains and services that originate from outside China mainland but have access point in China mainland"。<br>· `@-!cn`：**构建 bug，不是属性**。v2fly 的 `include:list2 @attr1 @-attr2` 是"选择性包含"语法（只包含带 attr1 且不带 attr2 的条目，"It's filtering, not flagging"）。zydou `convert.py` 把 `include:` 行上的 `@-!cn` 当作属性记录，生成的文件内容是无效行，如 `category-games-cn@-!cn.txt` 内容为 `.include:kurogames`、`.include:xd`（clash 分支为 `'+.include:kurogames'`）。<br>→ 属性名以 `-` 开头的文件应丢弃 |
| F3 | 带尾部空格的文件名（`openai@ads .txt`）是否为上游构建 bug，内容与无空格版是否相同 | 对比两个文件 | 索引时去重还是丢弃 | **是构建 bug，内容不同，两者是同一属性的两个互补子集。** 原因：`convert.py` 中 `for attr in line.split("@")[1:]` 没有 strip，一行带多个属性时（如 `domain @ads @cn`），除最后一个外的属性名都带尾部空格（`ads `）。所以 `openai@ads .txt` = 带 `@ads` 且后面还有其他属性的条目，`openai@ads.txt` = `@ads` 是最后一个属性的条目，**并集才是完整的 `@ads`**。<br>实测：`openai@ads` 空格版 3 行、无空格版 1 行；`alphabet@cn` 3 行 vs 121 行；`category-ads@cn` 3 行 vs 684 行。surge-domain-set 分支共 2109 个文件，带空格的 97 个，其中 74 个有无空格同名文件（其余 23 个只有空格版）。<br>另：`convert.py` 跳过 `regexp:` 规则 |
| F4 | jsDelivr 访问这两个仓库是否可用、缓存延迟多久；国内网络下 raw.githubusercontent.com 的可达性 | 实测 | REPO-07 默认 `urlTemplate` | · jsDelivr 按文件访问两个仓库都可用（200）：`cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/OpenAI/OpenAI.yaml`、`.../gh/zydou/domain-list-community-converter@clash/openai.yml`、`@mrs/openai.mrs`；`fastly.jsdelivr.net` 同样可用。但 `.../ios_rule_script@master/README.md`（仓库根）返回 **403**。<br>· 缓存头：jsDelivr `cache-control: public, max-age=604800, s-maxage=43200`（CDN 侧 12 小时、浏览器侧 7 天），响应头 `x-jsd-version` 为分支名；raw.githubusercontent.com `max-age=300`。<br>· 国内网络可达性 ⏳：本机经 Surge 系统代理出网，无法代表国内直连 |

---

## 7. 采集完成后需要决策的问题

以下问题**等采集完成后统一决定**，届时把结论回填到 05 §3.1：

| # | 问题 | 依赖的采集项 | 采集状态 |
| --- | --- | --- | --- |
| Q5 | 模板组之间的引用是否属于模板 | 无（产品决策） | — |
| Q6 | Profile 能否删除 / 改名模板中的组 | 无（产品决策） | — |
| Q8 | 普通用户能否编写脚本处理器 | 无（产品决策） | — |
| Q9 | Surge 输出中外部节点集：`policy-path` 还是内联 | S1、S2、S3、S5 | S1④、S2 组成员、S3、S5 运行时 ⏳ |
| Q10 | 项目名 | 无 | — |
| R1 | 规则仓库默认引用模式：直连还是托管 | C6、F4 | F4 国内可达性 ⏳ |
| R2 | 托管再分发 GPL-2.0 规则内容的合规方式 | 无（法律判断） | — |
| R3 | mihomo 默认选 mrs 还是 yaml | C6、M10 | M10 ✅；C6 仅 macOS 按版本推断 |
| R4 | 普通用户能否添加自定义仓库 | 无（产品决策） | — |
| D1 | Surge 是否支持"前置为可切换的组"（REF-12） | S4 | ✅ |
| D2 | Surge 包装组的防泄漏方案 | S5 | 已确认存在风险；候选写法运行时 ⏳ |
| D3 | 是否需要按 mihomo 内核版本降级输出 | M10、C2 | M10 ✅；C2 仅 macOS |

### 7.1 剩余采集项

均需 GUI、真机或国内网络，无法在命令行自动完成：

| 类别 | 项目 | 建议做法 |
| --- | --- | --- |
| Surge 运行时 | S1④ 两个 `policy-path` 是否都生效；S2 组成员直接写外部节点名；S3 外部节点自带 `underlying-proxy`；S5 `select, hidden=true` 空组的表现；S5 候选防泄漏写法 `fallback, Inner, REJECT`；`include-other-group` 展开带组级 `underlying-proxy` 的组时是否保留 ` (via X)` 派生策略（06 §5.3） | 新建一份**独立的**测试 Profile（不改现用配置），使用 `research/verification/surge/` 中的配置，配合本地 socks5（`research/verification/mihomo/run.sh` 起的 17001/17002 实例），在请求查看器中看实际走向 |
| UA 与响应头 | S12②、C1、C4、L5、T5 | 本地起 HTTP 服务记录请求头，各客户端导入订阅 URL |
| 面板 | M7、M9 | 各面板截图 |
| 客户端行为 | C3、C5、C6 导入实测；C2 的 Windows / Android | 导入测试配置 |
| 网络 | F4 国内直连可达性 | 在不经代理的国内网络下测试 |
| Loon / Stash | L1–L5、T1–T5 | P2，可延后 |

### 7.2 采集中观察到的设计影响（只记录，不决策）

供 §8 决策时参考，现有设计文档暂不修改：

1. **Surge 组级 `underlying-proxy` 可能让 S3 不再关键**：落地在外部节点集时，可以用 `X-chained = select, policy-path=..., policy-regex-filter=^X$, underlying-proxy=<前置>, hidden=true` 的嵌套组完成代理链，不必内联节点，也不必按 Profile 生成专属外部内容（对应 06 §5 的退化方案）。整源走前置时，直接给组加 `underlying-proxy`，对应 mihomo 的 `override.dialer-proxy`。代价：最低版本 iOS 5.22.0 / Mac 6.9.0；派生策略名带 ` (via X)` 后缀。
2. **Surge 筛空回退 DIRECT**（S5②），和 mihomo 未设 `empty-fallback` 时一样会静默直连，而 Surge 没有直接等价于 `empty-fallback` 的参数（D2）。
3. **mihomo 空组（TPL-10）实际会直连**（M7）：`proxies: [COMPATIBLE]` 的组可加载，但流量走 DIRECT。现行 PRD 已写"等效 DIRECT"；是否改为 REJECT 需要在 TPL-10 上重新确认。
4. **provider 不能设 `path`**（M8），否则 REF-11 的"改 URL 版本触发重新下载"不成立。
5. **同源 provider 内也不能直接写节点名**（M3）：06 规则二的表述"前置是 provider 中的节点时用包装组"对同源情况同样适用，06 场景 5 的表格可补一句。
6. **mihomo 与 Surge 测速参数语义不同**（S6）：mihomo 组 `timeout` 是单次测速超时（毫秒），Surge 组 `timeout` 是按延迟筛选候选（秒）；Surge 组级 `url` 已无效。04 §2 映射表不能直接一对一映射。
7. **Surge 不支持 vless / reality / hysteria v1、`DOMAIN-REGEX`**（S8、S11），iOS 忽略进程规则（S7）。
8. **zydou 适配器**（F2、F3）：丢弃 `@-` 开头的属性文件；带空格与无空格的同名文件需要**合并**（直连模式下要同时引用两个 URL，或只在托管模式下合并）。
9. **blackmatrix7 适配器**（F1）：使用说明句式是有限集合，可以用正则解析；需跳过上游来源 URL 列表，并识别 Surge 5.21.0 版本分段。

## 8. 决策记录

2026-10-28 维护者确认。第一轮采集后，剩余采集项（§7.1）不再阻塞决策，以下结论为**暂定**：剩余采集项的结果与暂定结论冲突时，回到此处修订。

| # | 决策 | 依据 / 备注 |
| --- | --- | --- |
| Q5 | **模板组之间的引用属于模板**。模板只禁止节点，组与组的嵌套随模板同步 | 与 TPL-01 一致 |
| Q6 | **Profile 不能修改模板组**：不能删除、改名或隐藏，只能填充成员、调整组参数；仍可新增 Profile 私有组 | 模板组 ID 与名称在所有 Profile 中一致，模板同步不产生孤儿组 |
| Q8 | **脚本处理器先仅限管理员，管理员可按用户授权**；普通用户可以引用管理员共享的脚本 | 沙箱（SYS-03）稳定前降低风险 |
| Q9 | **Surge 外部节点集只用 `policy-path`**，不做内联回退。外部节点上的代理链用组级 `underlying-proxy`（S3）；低于 iOS 5.22.0 / Mac 6.9.0 时代理链不可用，在渲染报告中提示 | S1、S3 |
| Q10 | 项目名定为 **sub-forge** | — |
| R1 | 规则仓库**默认直连**（配置中直接写上游地址，可切换 jsDelivr 等镜像）；需要改写或合并时自动转为托管 | F4；zydou 带空格文件的合并（F3）只能在托管模式下完成 |
| R2 | 托管输出**保留原文件头注释，并附来源 URL 与许可证名称**。非正式法律意见 | 规则是数据，不与代码链接 |
| R3 | mihomo **默认 mrs**，托管时输出 yaml | M10：mrs 自 v1.18.7 起支持，低于 D3 的最低版本 |
| R4 | **自定义规则仓库仅限管理员**；普通用户仍可使用远程 URL 规则集（RS-01） | — |
| D1 | **Surge 支持前置为策略组**，与 mihomo 一致（REF-12） | S4 |
| D2 | Surge 包装组暂用 `Inner = select, policy-path=..., policy-regex-filter=^X$, hidden=true` + `__ref = fallback, Inner, REJECT, hidden=true`；运行时验证前，UI 和渲染报告标注"Surge 防泄漏未验证"，验证失败再改 | S5；§7.1 运行时项 |
| D3 | **最低支持 mihomo v1.19.27，不按内核版本降级输出**；识别出更低版本时在渲染报告中告警 | M10、C2：`empty-fallback` 自 v1.19.27 起支持，主流客户端已是 v1.19.32 |
| TPL-10 | **空组的行为由模板组声明，默认拒绝**：每个模板组有"为空时"选项，取值为拒绝（默认）或直连。mihomo 输出 `proxies: [REJECT]` 或 `[COMPATIBLE]`；Surge 输出 `select, REJECT` 或 `select, DIRECT` | M7：`COMPATIBLE` 空组实测会直连；S5：Surge 不接受无成员无参数的组 |
