# 四客户端配置转换（2026-10-30）

本轮保留现有 IR、节点处理链、模板绑定/独立分流、依赖解析、快照和版本缓存，在共用管线末端增加 Surge、Loon 序列化器。没有引入 Sub-Store/subconverter 服务或运行时，也没有替换现有 Mihomo/Stash 渲染。

## 输出与存储

| 项目 | Mihomo | Surge | Loon | Stash |
| --- | --- | --- | --- | --- |
| 完整主订阅 | YAML | INI | INI | YAML |
| 基础预设 | `preset.mihomo` | `preset.surge` | `preset.loon` | `preset.stash` |
| 订阅覆盖 | `base.patch` | `base.surgePatch` | `base.loonPatch` | `base.stashPatch` |
| 节点集 | provider / inline | 快照内联 | 快照内联 | 快照内联 |
| 规则集 | 原始/托管 provider | 托管 LIST | 原位置展开到 `[Rule]` | 原始/托管 provider |
| 独立文件 | 现有 YAML 导出 | 规则内嵌 `.conf` | 完整 `.conf` | 规则内嵌 YAML |
| 平台 | 现有平台 | iOS / macOS | iOS / macOS | iOS / macOS |

INI 基础配置只含 `general` 和 `host`，编辑器显示 `[General]` / `[Host]`；节点、组、规则由对应领域对象生成。原生项仍按客户端独立合并；新增公共项只映射已适配语义，不把任意 Mihomo DNS/TUN 配置自动套到其他客户端。表单和 INI 双向转换保留 `false`、`0`、列表、引号和转义；清空字段恢复未配置状态。INI 大小写和行内注释按解析规则处理，非法段、重复键、换行注入和不支持的嵌套值报错。

`GET /sub/:token?target=surge|loon&platform=ios|macos` 返回 `text/plain`，URL 参数优先于 UA。Surge 主订阅含带当前 token 的 `#!MANAGED-CONFIG` 更新地址，并用 `#!FORBIDDEN-AUTO-UPGRADE smart-group` 避免自动改写策略组。独立导出不包含托管占位 token。未知客户端/平台返回 400。

预览返回 `format: "ini"`；历史 `yaml`、`exportYaml` 属性继续作为配置文本字段，避免破坏 API 和存储兼容。失败时仅回退到同客户端、同平台的上一份成功产物；没有可回退产物时返回 503，不发布半成品。规则资源继续绑定 token、客户端、平台、结构版本；手动资源刷新同时重建已发布的 Surge/Loon 目标。

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

节点输入支持完整 INI 的 `[Proxy]` 段及裸节点行，通过位置凭据和专有参数区分 Surge/Loon。凭据中的逗号、等号、引号、反斜杠以及显式 false 可往返。Surge VMess 输入要求显式 `vmess-aead=true`；旧的非 AEAD 配置无法忠实映射时拒绝导入。节点粘贴入口仍只导入节点；整份 Loon 配置使用配置订阅列表中的「导入 Loon 完整配置」入口。

## 公共基础配置与专用覆盖

预设新增 `common`，订阅新增 `base.common`。合并顺序为：**预设公共项 → 本订阅公共项 → 预设客户端原生项 → 本订阅客户端原生覆盖**。数组替换，对象递归合并，`false`、`0` 不当作空值。公共测速默认值进入节点/组适配流程，组显式参数优先；INI 端明确设置的全局测速覆盖优先于公共默认值。

| 公共项 | 映射与边界 |
| --- | --- |
| `dnsServers` | 普通 DNS IP / system → Mihomo、Stash nameserver，Surge、Loon dns-server；加密 DNS 和复杂上游参数保留原生配置 |
| `hosts` / `dnsPolicy` | 精确域名 → 单个固定 IP / DNS；INI 使用 Host。通配符、别名、SSID、域名集合与特殊 DNS 规则暂不提取 |
| `realIpDomains` | 精确域名 → fake-ip-filter / always-real-ip / real-ip；不同通配语法不互换，也不当作 DIRECT 分流规则 |
| `dnsIpv6` | Mihomo/Stash dns.ipv6，Surge ipv6；Loon ip-mode 还控制连接，不能等价替换。若明确配置 Loon ip-mode 则采用原生覆盖并警告，否则阻止该目标生成。Stash true 仍依赖网络状态并提示 |
| `geoipUrl` | Mihomo MMDB、Surge geoip-maxmind-url、Loon geoip-url；Stash 暂未适配 |
| `httpPort` / `socksPort` / `allowLan` | Mihomo 原生端口；Surge 需明确 macOS/iOS，macOS 使用监听地址，iOS/Loon 使用 Wi-Fi 代理共享并提示范围差异；Stash 暂未适配。Wi-Fi 端口不以 0 表示停用 |
| `testUrl` / `testTimeoutMs` | 默认代理测速 URL / 毫秒超时；各端按节点、组或全局作用域输出，不同组要求冲突时明确报错 |

预设和订阅基础编辑器提供「公共项」表单/YAML；原生标签提供「提取公共基础项」预览，只在「应用到草稿」后改变草稿，仍需保存。已有公共值优先于提取值，未映射字段保持原样并逐项报告。Mihomo `tun.stack=mips` 保留且表单可选。

`mode`、日志等级、TUN 栈/路由/DNS 劫持、FakeIP 模式与地址段、API/dashboard、HTTP 引擎、skip-proxy、STUN、网络接口选择等仍在专用覆盖维护。特别是 `skip-proxy` 不能自动改成 DIRECT，`*.example.com` 和 `*example.com` 不能盲目换成 Mihomo 后缀语法。原文中有 Host 通配/特殊条目时整个 Host 段保留，避免破坏匹配顺序。

## Loon 完整配置导入

入口：配置订阅列表 → 导入 Loon 完整配置。接口 `POST /api/profiles/import/loon`，默认只预览；`save:true` 创建资源。导入预览不联网，展示四端本地内容兼容报告；远程节点和规则需正常拉取后再次验证。资源使用新 ID，归属当前用户，创建失败整体回滚，不改已有订阅。

- 识别 `[General]`、`[Host]`、`[Proxy]`、`[Remote Proxy]`、`[Remote Filter]`、`[Proxy Group]`、`[Proxy Chain]`、`[Rule]`、`[Remote Rule]`。未适配的非空段、未知运行参数、重名、缺失引用、循环引用明确报错。
- 远程订阅保留 URL，不访问用户的真实地址。udp、block-quic、证书校验、fast-open 覆盖进入现有处理链；`default` 不覆写，VMess AEAD 仅作用于 VMess。停用来源保存为独立资源但不加入本订阅；flexible-sni=true 暂不适配。
- NameRegex 筛选器变成只包含启用远程来源的动态组合，`(?i)` 保留。重叠组合可能生成独立节点副本并自动改名，会报告改名。NodeSelect 缺少选择结果时给出提示；若被引用则拒绝导入。
- 当前导入两跳命名链，落地必须在 `[Proxy]` 声明，前置可为节点/策略组。为每个链名生成独立落地副本和已有 ChainRule，同一原落地可走多个前置，原出口不变。多跳或动态落地不能等价适配时明确报错。
- 缺少 FINAL 必须在原文补充或在表单明确选择最终出口，不默认选 DIRECT。远程规则保留现有远程引用，报告本地/远程及域名/IP 阶段匹配的差异；停用远程规则明确提示未加入分流。
- Loon `max-timeout` 独立保存在 `test.maxTimeout`，与全局单次测试超时区分；其他端尚未等价适配时阻止输出。可在策略组高级设置中清除。

节点转换统一规范 VLESS/VMess 的 `sni` 为 `servername`；冲突报错。Loon block-quic 布尔值对应 Surge on/off，Surge auto/adaptive 保留原值并在 Loon 报不兼容。Mihomo/Stash 当前没有适配等价的节点级阻断：true/on/auto/adaptive 报错，false/off 可省略；绝不擅自替换成全局拒绝 UDP 443。

新增依据：[Mihomo 域名语法](https://wiki.metacubex.one/handbook/syntax/)、[Mihomo TUN](https://wiki.metacubex.one/config/inbound/tun/)、[Loon General](https://nsloon.app/en/docs/General/)、[Surge General](https://manual.nssurge.com/profile/general.html)、[Surge 节点选项](https://manual.nssurge.com/policies/parameters.html)、[Stash DNS](https://stash.wiki/en/features/dns-server)。本轮实现和验收见[公共配置与完整导入验收](../research/verification/common-base-loon-import-20261030/验收记录.md)。

## 规则修复与边界

- 解析器按顶层逗号分割，保留引号、反斜杠和逻辑括号；支持递归 AND/OR/NOT 和 URL-REGEX。不能表示任一子条件时整条逻辑规则给出诊断，不删子条件放宽匹配。
- Surge `extended-matching` 保留在出口之后；其他客户端不能等价表示时诊断并跳过。未知尾参数拒绝解析，不静默丢弃。
- IP 去重键包含 `no-resolve` 和 `src`；整组 src 只加到 IP 规则，模板编辑往返不再生成 `DOMAIN,...,src`。
- 正则转通配符拒绝把转义的字面星号、问号或方括号扩大成通配语义。
- Loon 使用 DEST-PORT、PROTOCOL；进程规则只输出到 macOS，并提示名称匹配大小写差异。复杂进程正则、GEOSITE、DOMAIN-REGEX、SRC-IP-CIDR 等不强行转换。Mihomo 斜杠端口集合现会转为等价 OR，源端口与逻辑嵌套一并保留。
- RAW/本地原文仍为既有的显式透传入口；未指定客户端时不会自动解释未知语法，需由使用者确认目标支持。结构化规则和规则集转换提供语义诊断。
- Loon 将规则集原位置展开以避免本地与远程规则的优先级重排，但客户端自身仍有域名/IP 等匹配阶段，不能保证跨客户端完全相同的规则优先级。
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
