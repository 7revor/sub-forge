# Mihomo、Surge、Loon、Stash 官方配置指引与同步记录

核对日期：2026-10-29（Asia/Singapore）。本文件是项目的官方资料入口和更新核对表；正文为项目维护摘要，不复制整份上游手册。每次适配以链接对应的最新官方页面为准，记录最低版本及平台限制，不根据配置文件扩展名或“兼容 Clash”宣传直接推断行为。

## 1. 官方资料入口

### Mihomo

| 内容 | 官方入口 | 更新时关注 |
| --- | --- | --- |
| 配置总览 | [虚空终端 Docs · 配置](https://wiki.metacubex.one/config/) | 顶层字段、DNS、入站和出站分类 |
| 路由规则 | [路由规则](https://wiki.metacubex.one/config/rules/) | 类型列表、大小写、进程平台、规则选项 |
| 规则集合 | [rule-provider](https://wiki.metacubex.one/config/rule-providers/) | behavior、yaml/text/mrs、下载请求头 |
| 策略组 | [代理组配置](https://wiki.metacubex.one/config/proxy-groups/) | filter/exclude、动态成员、empty-fallback、测试超时 |
| 代理链 | [dialer-proxy](https://wiki.metacubex.one/config/proxies/dialer-proxy/) | 前置引用、跨 provider 及环路 |

使用 YAML；规则在 `rules` 中，集合在 `rule-providers` 中声明后用 `RULE-SET` 引用。规则集合的 `behavior` 和 `format` 是两个独立维度。MRS 当前用于 domain/ipcidr。健康检查 `timeout` 的单位为毫秒。下载请求头字段是 `header`，不要与 Stash 的 `headers` 混淆。依据：[规则集合](https://wiki.metacubex.one/config/rule-providers/)、[策略组](https://wiki.metacubex.one/config/proxy-groups/)。

最小结构示意（自编示例，不含真实节点）：

```yaml
mode: rule
proxies: []
proxy-groups:
  - name: 默认
    type: select
    proxies: [DIRECT]
rules:
  - DOMAIN-SUFFIX,example.test,默认
  - MATCH,DIRECT
```

本项目：完整主订阅、节点 provider、规则托管和结构版本已实现。`USER-AGENT` 的结构化解析有效，但 Mihomo 输出会转为客户端不支持注释；不因其他客户端支持而直接透传。

### Surge

| 内容 | 官方入口 | 更新时关注 |
| --- | --- | --- |
| 总手册 | [Surge Manual](https://manual.nssurge.com/) | Mac / iOS 产品与版本差异 |
| 配置语法 | [Profile Format](https://manual.nssurge.com/profile/format.html) | INI 段、托管配置、模块 |
| 规则概览 | [Rules Overview](https://manual.nssurge.com/rules/overview.html) | 类型索引、规则顺序和逻辑规则 |
| HTTP 规则 | [HTTP Rules](https://manual.nssurge.com/rules/http.html) | USER-AGENT、URL-REGEX、HTTP 引擎及 MITM 条件 |
| 规则集合 | [Rule Sets](https://manual.nssurge.com/rules/ruleset.html) | 不带出口的外部文本、DOMAIN-SET、版本限制 |
| 节点 / 策略组 | [Policies](https://manual.nssurge.com/policies/overview.html)、[Policy Groups](https://manual.nssurge.com/policy-groups/overview.html) | 节点字段、组类型、空组行为 |
| DNS | [DNS Overview](https://manual.nssurge.com/dns/overview.html) | DNS、Host 和流量接管 |

使用分段文本配置，例如 `[Proxy]`、`[Proxy Group]`、`[Rule]`。外部 RULE-SET 文件每行省略出口，主配置中的引用负责选择出口。`USER-AGENT` 支持通配符且匹配区分大小写；它是否能命中还取决于 HTTP 引擎能否看到相应请求头，不能把配置接受等同于实际命中。依据：[配置语法](https://manual.nssurge.com/profile/format.html)、[规则集合](https://manual.nssurge.com/rules/ruleset.html)、[HTTP 规则](https://manual.nssurge.com/rules/http.html)。

本项目：2026-10-30 已支持完整 Surge 主订阅、独立基础配置、节点、四类策略组、托管规则与独立文件导出。官方离线配置检查通过，真实客户端转发未验收；详见 [19](19-client-conversion.md)。

### Loon

| 内容 | 官方入口 | 更新时关注 |
| --- | --- | --- |
| 官方手册 | [Loon](https://nsloon.app/en/docs/intro/) | 导航、平台、功能变更 |
| 通用设置 | [General Configuration](https://nsloon.app/en/docs/General/) | 已废弃字段和最低 Build |
| 节点 | [Nodes](https://nsloon.app/en/docs/category/%E8%8A%82%E7%82%B9/) | 支持协议与各协议字段 |
| 策略组 | [Policies](https://nsloon.app/en/docs/category/%E7%AD%96%E7%95%A5/) | 组类型、引用、筛选 |
| 规则总览 | [Rules](https://nsloon.app/en/docs/Rule/) | 规则匹配顺序与语法 |
| HTTP 规则 | [HTTP Rules](https://nsloon.app/en/docs/Rule/http_rule/) | USER-AGENT、URL-REGEX |
| 规则订阅 | [Rule Subscriptions](https://nsloon.app/en/docs/Rule/sub_rule/) | 远程规则文件和引用参数 |
| DNS | [DNS](https://nsloon.app/en/docs/category/dns/) | DNS 与策略关联 |

配置结构及参数应直接对照 Loon 手册；不能将 Surge 的整段配置直接标记为 Loon。官方 HTTP 规则页明确列出 `USER-AGENT` 的通配匹配；规则订阅使用 Loon 支持的逐行规则语法。依据：[HTTP 规则](https://nsloon.app/en/docs/Rule/http_rule/)、[规则订阅](https://nsloon.app/en/docs/Rule/sub_rule/)。

本项目：2026-10-30 已接入 Loon IR 映射、保存校验、API、基础配置、节点、策略组、规则和完整 INI 订阅。规则集原位置内嵌；代理链与未适配协议明确报错。详见 [19](19-client-conversion.md)。

### Stash

| 内容 | 官方入口 | 更新时关注 |
| --- | --- | --- |
| 总入口 | [Stash 用户文档](https://stash.wiki/) | macOS、iOS / tvOS 的版本差异 |
| 完整配置样例 | [配置样例](https://stash.wiki/configuration/example-config) | YAML、DNS / HTTP 引擎、原生字段 |
| 规则 | [规则类型](https://stash.wiki/rules/rule-types) | USER-AGENT、进程规则、源地址/端口的 Beta 限制 |
| 规则集合 | [规则集合](https://stash.wiki/rules/rule-set) | behavior、text/yaml/mrs、inline、headers |
| 节点协议 | [协议类型](https://stash.wiki/proxy-protocols/proxy-types) | Hysteria2 auth / 带宽、Reality、传输方式 |
| 策略组 | [策略组](https://stash.wiki/proxy-protocols/proxy-groups) | 空组直连、筛选、动态成员、负载均衡 |
| 节点集合 | [远程代理集](https://stash.wiki/proxy-protocols/proxy-providers) | use、headers、空 provider 行为 |
| 代理链 | [代理链](https://stash.wiki/proxy-protocols/dialer-proxy) | dialer-proxy 最低版本及 provider 限制 |
| 延迟测试 | [延迟测试](https://stash.wiki/proxy-protocols/proxy-benchmark) | 节点级 benchmark 参数，超时单位为秒 |
| 覆写 | [Override](https://stash.wiki/configuration/override) | 与主配置的合并行为 |
| 发布日志 | [macOS](https://stash.wiki/release-notes/macos)、[iOS](https://stash.wiki/release-notes/ios)、[tvOS](https://stash.wiki/release-notes/tvos) | 文档先于正式版时，保留 Beta 标记 |

Stash 使用 YAML；配置、节点集和规则集的形状与 Clash 家族相近，具体字段应按 Stash 文档适配。[官方配置样例](https://stash.wiki/configuration/example-config)

本次核对并落实的差异：

- `USER-AGENT`、`DOMAIN-REGEX`、`GEOSITE`、`NETWORK` 等规则按 Stash 能力输出。进程规则仅 macOS；未指定平台时不输出进程规则。路径通配 / 路径正则未建立等价映射，保留客户端诊断。源地址 `SRC-IP`、源端口 `SRC-PORT` 页面标为 Beta iOS/tvOS 3.7+ / macOS 4.4+，转换结果带版本提示。[规则类型](https://stash.wiki/rules/rule-types)
- Hysteria2 将 IR 中的 `password` 转成 `auth`，`up/down` 转成 Mbps 数值的 `up-speed/down-speed`。未适配的协议和传输明确阻止成功导出。[协议类型](https://stash.wiki/proxy-protocols/proxy-types)
- Stash 空组可能直连。本项目为保持现有筛选与空组拒绝语义，将节点集在导出时按快照内联，展开动态成员；筛空补 REJECT。当前不生成 Stash 节点 provider，节点更新随主订阅刷新。[策略组](https://stash.wiki/proxy-protocols/proxy-groups)、[远程代理集](https://stash.wiki/proxy-protocols/proxy-providers)
- 延迟测试 URL / 超时下放到节点的 `benchmark-*` 字段，并将毫秒转换为秒。共享节点要求测试设置一致，冲突时报错。[延迟测试](https://stash.wiki/proxy-protocols/proxy-benchmark)
- 代理链使用 `dialer-proxy`，按官方要求检查与 `interface-name` 互斥。官方最低版本为 iOS/tvOS 3.2.5+ / macOS 4.1+；provider 内代理链另有更高版本要求，本次内联导出不依赖它。[代理链](https://stash.wiki/proxy-protocols/dialer-proxy)

## 2. 本项目使用方式

### Stash 主订阅

保留现有订阅 token，显式使用：

```text
/sub/<token>?target=stash&platform=ios
/sub/<token>?target=stash&platform=macos
```

Stash User-Agent 可以自动识别；显式参数优先。前端「订阅 → 概览」只提供一个无参数链接，Stash 与 Mihomo 客户端共用该链接，浏览器直接显示 Mihomo YAML；「预览」选择 Stash 和平台，可查看草稿及导出独立 YAML 文件。导出文件把本次已转换的托管规则内嵌到 `rules` 中，避免依赖预览占位 token；原始远程规则集合继续使用其真实 URL。

Stash 专属基础设置保存在预设的 `stash` 和订阅的 `base.stashPatch`，按预设加覆盖合并。既有 `mihomo` / `base.patch` 继续只用于 Mihomo，避免误带其 DNS / TUN 开关。`base` 省略时使用客户端默认设置。

主订阅、配套规则链接、缓存、last-good 和保留的结构版本都区分客户端与平台。修改 `target` 或 `platform` 不能借用另一套资源；撤销 token 后资源链接失效。

### 单独转换规则

```text
GET /api/rules/convert?url=<完整编码的上游URL>&target=stash&platform=ios
```

转换预览需要登录；正式公共规则通过 `/r/:token/:key` 托管，任意有效用户令牌可读，旧 token 转换入口已移除。转换不会将未知类型当作可执行规则透传。规则编辑器中显式输入 RAW 仍沿用原有的原文输出语义。

## 3. 后续同步流程

1. 先核对官方配置总览、受影响的具体章节及平台发布日志，记录日期、链接、平台、最低版本、Beta / 正式状态；找不到依据时标记待确认。
2. 明确区别：官方支持、项目 IR 可解析、项目可输出、真机已验证。新增客户端支持不应自动放行其他客户端。
3. 更新 `packages/core/src/rules/client.ts`、规则解析和 `render/stash-config.ts`；涉及身份时同步服务端识别、参数校验、资源链接、缓存和历史版本。
4. 同步前端预览、覆盖、基础设置及链接入口；更新需求、领域模型、能力矩阵、设计对照和本文件。外部画布未改动时记录待同步，不能宣称已同步。
5. 回归至少覆盖：官方正常示例、当前不支持类型、格式错误、平台限制、输出字段与单位、空组、代理链环、预览与下载一致、跨客户端/平台版本隔离、token 撤销和 last-good。
6. 浏览器验收使用 Codex 内置浏览器；真实 Stash / Surge / Loon 的导入、启动和实际转发验收需单独记录。没有客户端环境时明确未执行，不用 Mihomo `-t` 代替其他客户端校验。
7. 提交变更后更新下面的同步记录。此清单是人工更新指引，不会自行创建定时任务或自动追踪上游。

## 4. 同步记录

| 核对日期 | 客户端 | 本轮结论 | 验证层级 |
| --- | --- | --- | --- |
| 2026-10-29 | Mihomo | 官方配置与规则/provider/组/代理链入口纳入索引；保留既有主订阅 | 代码及自动化回归；条件性内核运行测试按环境跳过 |
| 2026-10-29 | Surge | USER-AGENT 规则转换已支持；完整主订阅仍未实现 | 转换/API 回归；未进行 Surge 真机验收 |
| 2026-10-29 | Loon | 登记官方配置指引及 HTTP 规则/规则订阅入口 | 文档核对；未新增代码适配，未真机验收 |
| 2026-10-29 | Stash | 完整订阅、独立文件导出、规则转换及 iOS/macOS 预览接入；节点按快照内联 | 自动化及内置浏览器结果见[验收记录](../research/verification/stash-support-20261029/验收记录.md)；未进行 Stash 真机导入/转发验收 |
| 2026-10-30 | Surge | 完整主订阅、独立导出、基础配置、节点与策略组接通 | 全量回归、内置浏览器、官方 surge-cli 离线检查；未真机转发 |
| 2026-10-30 | Loon | 独立 INI 适配、规则集内嵌、平台规则与失败回退接通 | 全量回归和内置浏览器；未运行官方校验器或真机转发 |
