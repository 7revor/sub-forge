# 四客户端配置转换（2026-10-30）

本轮保留现有 IR、节点处理链、模板绑定/独立分流、依赖解析、快照和版本缓存，在共用管线末端增加 Surge、Loon 序列化器。没有引入 Sub-Store/subconverter 服务或运行时，也没有替换现有 Mihomo/Stash 渲染。

## 输出与存储

| 项目 | Mihomo | Surge | Loon | Stash |
| --- | --- | --- | --- | --- |
| 完整主订阅 | YAML | INI | INI | YAML |
| 订阅追加原文 | `base.kernels.mihomo` | `base.kernels.surge` | `base.kernels.loon` | `base.kernels.stash` |
| 节点集 | provider / inline | policy-path / inline | Remote Proxy / inline | proxy-providers / inline |
| 规则集 | 托管 provider | 托管 LIST | 托管 `[Remote Rule]` | 托管 provider |
| 独立文件 | 现有 YAML 导出 | 规则内嵌 `.conf` | 含规则时通过正式订阅获取 `.conf` | 规则内嵌 YAML |
| 平台 | 现有平台 | iOS / macOS | iOS / macOS | iOS / macOS |

基础配置使用「内核公共追加＋可选客户端追加」，只保存原生文本，取消表单解析、公共字段提取及跨内核转换。Mihomo/Stash 填写 YAML；Surge/Loon 填写 INI。DNS 分流、加密 DNS、Hosts、IPv6、GeoData、skip-proxy、TUN 排除及 fake-ip-range 全部由用户在对应内核原文中维护，不猜测等价关系。详见[原文追加约定](20-native-client-append.md)。

`GET /subs/profile?id=配置ID&token=用户token&target=surge|loon&platform=ios|macos` 返回 `text/plain`，URL 参数优先于 UA。token 为当前用户的统一资源令牌，配置必须属于该用户。Surge 主订阅含带当前 token 和配置 ID 的 `#!MANAGED-CONFIG` 更新地址，并用 `#!FORBIDDEN-AUTO-UPGRADE smart-group` 避免自动改写策略组。独立导出不包含托管占位 token。未知客户端/平台返回 400。

预览返回 `format: "ini"`；历史 `yaml`、`exportYaml` 属性继续作为配置文本字段，避免破坏 API 和存储兼容。失败时仅回退到同内核、同客户端的上一份成功产物；没有可回退产物时返回 503，不发布半成品。公共仓库和增强规则产物按资源身份、处理参数、内核共享；直接远程规则及 Loon 手写规则按订阅私有，下载校验所有者、客户端与当前规则引用。节点资源仍按用户隔离，具体见[全局托管约定](19-managed-resources.md)。

## 节点和策略组

| 能力 | Surge | Loon |
| --- | --- | --- |
| 已适配节点 | SS、VMess AEAD、Trojan、AnyTLS、HTTP(S)、SOCKS5/TLS、Snell、TUIC/v5、Hysteria2 | SS、SSR、VMess、VLESS（含 Reality）、Trojan、AnyTLS、HTTP(S)、SOCKS5/TLS、Hysteria2 |
| WebSocket | VMess | VMess / VLESS / Trojan 的已适配字段 |
| Hysteria2 | Salamander、下载带宽、端口跳跃 | Salamander、下载带宽、端口跳跃 |
| 代理链 | `underlying-proxy`，继续检查引用和环 | 输出 `[Proxy Chain]`，继续检查引用和环；命名链使用独立落地副本 |
| 四类策略组 | select / url-test / fallback / load-balance | 同左 |
| 哈希负载均衡 | consistent-hashing → persistent | consistent-hashing → PCC |
| 轮询负载均衡 | 没有等价转换，报错 | round-robin → Round-Robin |
| 单次测速超时 | 毫秒转秒，下放节点；共享节点参数冲突报错 | 毫秒转秒放 General；组间或与基础设置冲突时报错 |
| 空组 | REJECT | REJECT |

协议名出现在表内不代表所有可选参数都已覆盖。未适配协议、传输或重要参数给出错误；已明确允许省略的差异（例如部分显示/测速选项和上传带宽）在报告中说明。Loon 不输出 PASS、TUIC、Snell 或 WireGuard；Surge 不输出 VLESS/Reality。引用、重名、筛选和循环检测继续使用已有实现。

节点输入支持完整 INI 的 `[Proxy]` 段及裸节点行，通过位置凭据和专有参数区分 Surge/Loon。凭据中的逗号、等号、引号、反斜杠以及显式 false 可往返。Surge VMess 输入要求显式 `vmess-aead=true`；旧的非 AEAD 配置无法忠实映射时拒绝导入。节点粘贴入口仍只导入节点。

自动生成的 Loon 辅助名称使用下划线分隔：链落地副本为 `原节点名_链落地`，与节点或策略组重名时依次尝试 `原节点名_链落地_2`、`原节点名_链落地_3`；代理链引用同步使用最终名称。用户已有名称按原文保留，页面说明和诊断文字中的间隔号不参与名称规范化。

## 内核与客户端原文追加

常规合并顺序为：**订阅内核公共原文 → 订阅客户端原文（可选）**。产品内核分组为 Mihomo、Surge、Loon；FlClash、Clash Verge Rev、Stash 归入 Mihomo，Apple 两端按应用选择。保存只检查目标及字符串类型，未写完的原文也能保存。生成时解析必要的结构：YAML 映射递归合并、数组/标量/null 后层替换；INI General/Host/MITM 同名键后层替换，其余段落按顺序追加。原文不回写，错误会在预览报告，不会静默丢字段。

Stash iOS/macOS 直接列在 Mihomo 下，无中间 Stash 菜单；FlClash、Clash Verge Rev 不再单列。Stash 的继承顺序为 **Mihomo 公共 → 历史 Stash 公共（若存在） → Stash 应用追加**。Stash 输出目标与序列化保留，其他应用仍按两层合并。客户端页直接展示非空的上层只读原文，不套卡片、不折叠，代码区底部只保留来源与只读标识；空公共配置不显示。当前目标由左侧导航表达，格式化与清空位于编辑器底栏。规则集合预览仅保留三个顶层选项。完整约定见 [20](20-native-client-append.md)。

节点、策略组、规则仍由原有模块管理；原文包含这些受管理的段时生成报错。listeners 仅允许放在订阅追加。基础预设已移除；旧引用迁移为订阅原文。升级前的对象及公共映射只在 v28 一次迁移中使用，保留加密备份与迁移提示。

## 解析职责

不提供整份 Loon 配置导入入口，不从整份配置批量创建订阅、节点来源、节点集或代理链。

- 模板导入只提取策略组、规则、规则集来源引用与最终出口，忽略节点、DNS、端口等运行配置，详见[模板 YAML 导入](template-yaml-import.md)。
- 节点与规则内容由各自模块解析，继续用于订阅生成和内核格式转换。
- 基础配置按内核／客户端原文保存，不提取为表单、不转换为公共字段；生成时只做必要的结构合并和受管理段冲突检查。

节点转换统一规范 VLESS/VMess 的 `sni` 为 `servername`；冲突报错。Loon block-quic 布尔值对应 Surge on/off，Surge auto/adaptive 保留原值并在 Loon 报不兼容。Mihomo 当前没有适配等价的节点级阻断：true/on/auto/adaptive 报错，false/off 可省略；绝不擅自替换成全局拒绝 UDP 443。Stash 按公共生成保留 `block-quic` 原值，不再套用 Mihomo 的阻断检查；字段保留不等于已完成真机执行验证。

新增依据：[Mihomo 域名语法](https://wiki.metacubex.one/handbook/syntax/)、[Mihomo TUN](https://wiki.metacubex.one/config/inbound/tun/)、[Loon General](https://nsloon.app/en/docs/General/)、[Surge General](https://manual.nssurge.com/profile/general.html)、[Surge 节点选项](https://manual.nssurge.com/policies/parameters.html)、[Stash DNS](https://stash.wiki/en/features/dns-server)。此前的公共配置映射及完整导入验收仅作历史记录；当前基础配置遵循[原文追加约定](20-native-client-append.md)。

## 规则修复与边界

- 解析器按顶层逗号分割，保留引号、反斜杠和逻辑括号；支持递归 AND/OR/NOT 和 URL-REGEX。不能表示任一子条件时整条逻辑规则给出诊断，不删子条件放宽匹配。
- Surge `extended-matching` 保留在出口之后；其他客户端不能等价表示时诊断并跳过。未知尾参数拒绝解析，不静默丢弃。
- IP 去重键包含 `no-resolve` 和 `src`；整组 src 只加到 IP 规则，模板编辑往返不再生成 `DOMAIN,...,src`。
- 正则转通配符拒绝把转义的字面星号、问号或方括号扩大成通配语义。
- Loon 使用 DEST-PORT、PROTOCOL；进程规则按内核输出，并提示名称匹配大小写差异；平台差异由目标客户端处理。复杂进程正则、GEOSITE、DOMAIN-REGEX、SRC-IP-CIDR 等不强行转换。Mihomo 斜杠端口集合现会转为等价 OR，源端口与逻辑嵌套一并保留。
- RAW/本地原文仍为既有的显式透传入口；未指定客户端时不会自动解释未知语法，需由使用者确认目标支持。结构化规则和规则集转换提供语义诊断。
- Loon 将全部手写规则、仓库规则、直接远程规则和增强集合按原列表顺序写入 `[Remote Rule]`，每项使用 `托管URL,policy=出口,enabled=true`；`[Rule]` 仅保留 `FINAL`。同一规则的不同出口引用保留各自位置，不按 URL 去重。规则正文不携带出口，继续保留客户端改写、逻辑匹配和 `no-resolve`。
- 手写规则按每个列表项生成订阅私有产物，使用 `/subs/ruleset`，不注册为公共资源。删除、禁用或改写匹配内容时撤销旧正文；规则正文只按内核生成；资源读取校验用户和当前订阅引用，生成缓存保留客户端维度以隔离基础追加。升级后的 Loon 不再回退到旧内联 last-good。
- Loon 草稿预览不发布规则产物、不发行令牌。含托管规则时返回 `exportUnavailableReason` 并禁用草稿导出，需保存后使用正式订阅链接获取；不通过内联正文规避托管要求。没有分流项、仅 `FINAL` 的配置仍可直接导出。
- 全部规则置于远程段可避免本地规则优先于远程规则造成的跨段重排，但 Loon 自身仍按域名/IP 等阶段匹配，不保证跨客户端完全相同的命中顺序。依据：[Loon 规则优先级](https://nsloon.app/docs/Rule/)、[官方配置示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/example.conf)。
- 旧二进制规则不能解码或转换时明确报错；本轮不新增通用 MRS/SRS 解码器。

## 上游参考与版本要求

字段映射以官方文档为准，参考以下固定版本的成熟实现，独立实现本项目适配层：

- [Sub-Store Surge producer](https://github.com/sub-store-org/Sub-Store/blob/6e3d4c28dd16004ecfadd26eddb5abfdd2912212/backend/src/core/proxy-utils/producers/surge.js)、[Loon producer](https://github.com/sub-store-org/Sub-Store/blob/6e3d4c28dd16004ecfadd26eddb5abfdd2912212/backend/src/core/proxy-utils/producers/loon.js)：节点字段、协议差异和不支持能力。
- [subconverter 配置导出](https://github.com/tindy2013/subconverter/blob/a0d4eab28cb8b6c782d4ce5c3a918de4829b4a72/src/generator/config/subexport.cpp)：策略组与 INI 段结构；未引入其运行时或复制实现。
- Surge：[格式与转义](https://manual.nssurge.com/profile/format.html)、[基础设置](https://manual.nssurge.com/profile/general.html)、[托管配置](https://manual.nssurge.com/profile/managed-profile.html)、[节点参数](https://manual.nssurge.com/policies/parameters.html)、[策略组参数](https://manual.nssurge.com/policy-groups/parameters.html)。引号内转义要求 iOS 5.21 / Mac 6.8 及以上；HTTPS 节点测速 URL 要求 iOS 5.23 / Mac 6.10 及以上；具体协议仍取决于客户端版本。
- Loon：[节点](https://nsloon.app/en/docs/Node/)、[基础设置](https://nsloon.app/en/docs/General/)、[策略组](https://nsloon.app/en/docs/Policy/policygroup/)、[规则优先级](https://nsloon.app/en/docs/Rule/)、[逻辑规则](https://nsloon.app/en/docs/Rule/logic_rule/)、[域名规则](https://nsloon.app/en/docs/Rule/domain_rule/)。逻辑规则和扩展端口匹配需 3.1.7+；DOMAIN-WILDCARD 需 Build 1008+。本系统不按客户端版本自动切换方言。

## 验证

全量测试 1,142 项通过、46 项按环境条件跳过；类型检查和前端生产构建通过。Surge 官方离线检查覆盖九类节点、四类组及浏览器导出的完整配置。内置浏览器验证基础设置、保存重开、转换预览、平台差异和独立文件下载，详见[验收记录](../research/verification/surge-loon-20261030/验收记录.md)。

Loon 没有在本机执行官方配置校验器；Surge/Loon 的真实客户端导入、启动和实际代理转发均未执行。离线语法检查、单元测试和网页验收不等于真实连接验收。外部设计画布未修改。

## Mihomo 公共子集测试

后续逐项测试覆盖 77 个场景、四端 308 个生成组合，补充准确字段、单位、成员、规则出口、节点导入与基础配置隔离断言，并修复端口集合在 Surge 无法加载的问题。公共范围、条件、官方校验结果及四端示例见[多端可移植性验收](../research/verification/mihomo-portability-20261030/验收记录.md)。上方验证数字是首轮实现验收，本轮结果以新记录为准。


2026-10-30 后续重构：当前基础配置与规则维度以 [20](20-native-client-append.md) 为准。早期公共映射验收仅描述历史实现。

## 2026-11-02：遵循节点来源输出设置

四个内核都保留每个来源的 `provider` / `inline` 选择。引用来源由本服务生成专属远程资源，展开来源写入主配置，支持两者混用。Surge 策略组使用 `policy-path` 和秒单位的 `update-interval`；Loon 声明 `[Remote Proxy]` 并在策略组引用订阅名，禁用额外解析器；Stash 与 Mihomo 共用 `proxy-providers` 声明及 `use` 引用，包括公共 `type: http`、`url`、`interval`、`proxy: DIRECT` 字段。

- 远程资源仍走 `/subs/nodes?kind=provider&profile=…&id=…&target=…`，正文分别是 Surge 节点行、Loon 节点行、Stash YAML。来源处理链、组合成员及前后缀先执行；上游私有地址不会直接下发。
- 三端组级包含 / 排除正则、排除类型和精确节点引用由服务端生成稳定的派生资源；每次刷新重新计算。Surge 多个引用来源合成一个远程资源，保持来源顺序。派生资源继承原来源的权限和去重流量统计。节点重名时同步改名与引用，Loon 订阅名与策略名冲突时分配独立名称。
- 筛空的组输出 REJECT，不引用空集合；旧派生地址失效，空原始资源返回 503，避免客户端把空 provider 转成 DIRECT。后续新增节点后需刷新主订阅恢复空组的远程引用。网络失败时是否保留客户端本地缓存取决于客户端本身。
- Surge 远程正文保留 `underlying-proxy`；Mihomo 与 Stash 的代理链共用生成和校验：前置可以是普通策略组，远程单节点引用使用精确隐藏组，`dialer-proxy` 不直接填写 provider 名称。Stash 不额外改写同集前置，也不添加跨 provider、网卡组合等专用阻断或提示。Loon 远程落地仍不能携带 `[Proxy Chain]`，需要显式将落地来源设为展开。
- 草稿远程链接含占位令牌，含远程节点时禁用独立文件下载，使用保存后的正式订阅链接。选择展开后恢复原有独立导出；Loon 含远程规则时仍需正式订阅。
- 失败回退不会使用旧版强制内联的成功结果，也不会回退到与当前节点输出设置不同的产物。

依据（2026-11-02 核对）：[Surge 外部策略](https://manual.nssurge.com/policy-groups/policy-including.html)、[Loon 订阅节点](https://nsloon.app/docs/Node/subscription/)、[Loon 官方示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/example.conf)、[Stash 远程代理集](https://stash.wiki/proxy-protocols/proxy-providers)、[Stash 代理链](https://stash.wiki/proxy-protocols/dialer-proxy)。


## 2026-11-02：公共 Clash/Mihomo 生成

服务端主订阅、草稿预览及独立节点接口均通过 `renderClash(input, client)` 生成 Mihomo / Stash YAML。`renderMihomo` 和 `renderStash` 仅作为兼容入口保留，共用解析、节点处理、策略组构造、provider 声明、依赖解析及循环校验。

- Stash 不维护节点协议、传输或扩展字段白名单。`smux`、`ip-version`、组级扩展等按公共生成保留；保留字段只表示没有丢失用户配置，不代表已完成客户端执行验证。
- Stash 最末层仅处理 Hysteria/Hysteria2 字段与带宽单位、节点测速参数、空集合保护，以及明确不同的规则写法。`auth/up-speed/down-speed` 输入在公共层归一化，再按目标输出，认证或带宽别名冲突明确报错。Stash 的 `block-quic: off` 原样保留，结构化 `URL-REGEX` 和 `USER-AGENT` 正常输出。
- 动态成员先使用公共 Clash 表达；需要托管筛选和空集合保护时再展开。原生扩展中的 `include-all*` 也经过同一保护。Stash 的派生远程子集仍保持稳定地址和 REJECT 语义，这一差异不修改代理链前置名称。
- `dialer-proxy: upstream-select` 在两端保持一致；精确远程节点前置在两端使用相同隐藏组名称、依赖记录及落地引用。本服务不为 Stash 额外改写、禁止或提示这些代理链组合；引用缺失、循环等公共校验继续生效。
- Stash 缓存记录公共生成版本，失败不会回退到旧专用改写产物。基础配置继续遵循 Mihomo 公共 → 历史 Stash 公共 → Stash 应用追加的继承顺序。

公共规则使用独立的内容版本。2026-11-02 将版本从 2 提升为 3，避免规则来源未变化时继续命中旧版省略 `URL-REGEX` 的正文。该版本只参与内容哈希，不改变资源身份和已发布链接；旧产物下次读取时按需重建，成功后继续缓存。主配置与公共规则的失败策略分别保留：主配置禁止回退旧 Stash 专用生成结果；公共规则重建失败仍带告警返回最后成功正文，并保留旧内容版本以便后续重试。

验证与运行边界见[公共生成验收](verification/stash-common-20261102/README.md)。
