# @sub-forge/core

渲染内核（M0）：纯函数库，不做网络与存储 I/O。快照、模板、规则集都由调用方传入。

| 目录 | 内容 | 对应文档 |
| --- | --- | --- |
| `src/proxy` | 订阅内容解析：URI / Base64 / Clash YAML / Surge `[Proxy]` → `ProxyIR` | PRD SRC-01、SRC-04、SRC-10 |
| `src/pipeline` | 处理链与 P0 处理器，逐步 trace，末尾去重兜底 | SRC-06、SRC-07、SRC-11 |
| `src/nodeset` | 订阅源 / 组合 / 本地节点组解析，组合环检测 | COL-01–04、LOC-01 |
| `src/rules` | 规则 IR、规则集解析、按客户端降级与覆盖、多来源规则集合并与自动输出格式（原规则包并入规则集） | RS-01–03、RS-08、原 RB-01–05、CR-01–02 |
| `src/template` | 绑定/独立分流解析、旧覆盖层迁移支持、模板保存前自检 | 03 §5、TPL-07 ①、PRF-04、PRF-09 |
| `src/render` | mihomo 渲染：依赖解析、代理链、引用校验、环检测 | 03 §4、REF-01–12 |

节点 YAML 支持单节点映射、裸节点列表及带 `proxies` 的完整配置，也支持相应行内写法。整体缩进的复制片段可直接解析，嵌套与未知字段保持原样；单个节点缺少必填字段记入 `failures`，语法损坏仍抛出错误，由调用方决定如何展示。

地区旗帜处理器识别中文、英文地区名和常用代码；流量、到期等说明节点即使包含 `GB` 等字样也不添加旗帜。花云本地快照的 88 个地区节点和 2 个说明节点已用于回归核对。

`parseClientProxyObject` 供本地原始配置导入使用：支持 VMess 分享 JSON、sing-box 常见出站，以及 Xray / V2Ray 的 VLESS、VMess、Trojan、Shadowsocks、HTTP、SOCKS5 出站。覆盖常用认证、TLS / Reality、WS / HTTPUpgrade / gRPC；未知字段、不支持的传输及多服务器 / 多账号配置明确报错，不静默丢弃。不会把客户端的路由、DNS 或策略组转换为节点，也不联网取订阅。

## 测试

```bash
pnpm --filter @sub-forge/core test
```

配置合法性校验（`test/integration/mihomo-config.test.ts`）把渲染结果交给真实 mihomo 内核（v1.19.27+）执行 `-t`，未设置 `MIHOMO` 时自动跳过：

```bash
MIHOMO=/path/to/mihomo pnpm --filter @sub-forge/core test
```

- 只解析配置，不启动代理、不监听端口；macOS 上用 `sandbox-exec` 禁止 mihomo 联网，地址全部指向 `127.0.0.1:9`。
- `-t` 不解析 provider 内容，因此每个场景还会把 provider 节点展开到顶层 `proxies` 再校验一次，覆盖节点字段与注入的 `dialer-proxy`。
- GEOIP 规则在 `-t` 阶段就要加载 MMDB；设置 `MIHOMO_MMDB=<Country.mmdb 路径>` 时一并校验，否则跳过 GEOIP。

运行时代理链测试（`test/integration/mihomo-chain.test.ts`）会起 socks5 实例并转发流量，默认关闭，需要再加 `MIHOMO_RUNTIME=1`。推荐在 Docker 验证镜像中运行（仓库根目录 `pnpm test:docker`），镜像内已备好 mihomo 与 MMDB，容器以 `--network none` 运行。

规则参数运行时测试（`test/integration/mihomo-rule-options.test.ts`）使用同样的开关，启动容器内回环 DNS 与 HTTP 服务，实测 `no-resolve` 的查询行为和 `src` 的来源 IP 匹配；测试结束自动关闭服务与内核进程。

模板保存前的影响分析（TPL-07 ②）已在服务层完成：逐个试渲染现有 Profile。模板规则内容的可用性检查也由服务层负责，详见 [后端修复记录](../../docs/12-backend-regression-fixes.md)。内核负责结构校验，以及阻止无效远程规则快照被渲染为成功的空分流配置。

## 尚未实现

- 脚本处理器与规则改写脚本（SRC-08、CR-03，需要沙箱，P1）
- 逻辑规则 AND / OR / NOT（RS-04，P1）
- Surge 输出（M2）
- ssr、hysteria v1、wireguard、snell 的 URI 解析（这些协议目前只能通过 Clash YAML 导入）

规则集客户端改写存放在 `RuleSet.overrides`：仅按规则内容精确匹配所有启用来源，不依赖来源选择或行号。先应用第一条客户端/平台匹配的改写，再合并去重并输出一个 classical LIST；二进制来源需要改写时明确报错。来源级 `overrides` 只用于未能转换的历史数据兼容。


规则仓库首期（2026-10-29）在服务端将文本变体转换为本内核已有的多个远程来源，再复用规则集解析、合并与去重。内核数据模型不变；动态 `repo` 来源与客户端变体切换仍为后续能力。

2026-10-29：自定义 GitHub 仓库复用 `parseRuleSetContent` 的自动识别/classical/域名/CIDR/YAML 文本解析、拒绝行诊断和既有渲染流程；不增加新领域来源类型。仓库配置与文件索引归服务端管理，导入后仍为 remote。

规则来源可带 `repository: { repo, entry, ref, path }` 表示仓库文件关联；仍为远程来源，URL 约束由服务端负责，内核解析、合并、去重不变。

文本来源统一通过 `parseRuleSourceContent` 按内容识别，旧 format 不再强制指定解析器（仅保留域名方言与二进制兼容）。预览始终解析为规则 IR；`ruleSetDelivery` 判断原格式透传或托管转换。单一启用远程来源、无覆写、IP 选项处理或自定义 UA，且目标客户端支持原内容时直接引用上游，并设置实际 format 和 behavior；否则生成一个 `.list`（text/classical）。拒绝行、方言转换也触发托管。旧 MRS/SRS 无解码能力，无法转换时明确失败。`conversion: yaml-to-list` 仅作为旧版预览解析诊断兼容，是否托管以 delivery 为准。仓库仍只索引 list/txt。

模板的 `ruleset` 匹配项支持可选 `repository` 文件映射。调用方在渲染前将本地与仓库引用统一为 `RuleSetInputs`；内核继续按同一规则管线处理，不负责访问 GitHub。没有 repository 的旧 ID 引用保持兼容。

2026-10-29 模板规则集行内编辑仅调整前端布局；RuleEntry 的 matcher、target、enabled、options.noResolve 与规则顺序保持原语义，核心渲染和示例种子不变。

策略组空组固定拒绝：生成时无成员补 REJECT，所有组自动输出 `empty-fallback: REJECT`；历史 `whenEmpty: direct` 与扩展字段不能覆盖。`exclude-type` 统一解析 ss / Shadowsocks 等协议别名，使内联筛选与 provider 客户端行为一致。

2026-10-29 规则集前端移除整组 no-resolve 配置入口；核心保留 `RuleSet.noResolve` 以兼容历史数据，规则本身和模板引用的选项处理不变。


2026-10-29：mihomo 转换时，PROCESS-NAME-WILDCARD / PROCESS-PATH-WILDCARD / DOMAIN-WILDCARD 按 lowercase 值去重，保留首条原始写法及行位；名称与路径不混合，精确、正则与 Surge 保持原行为。合并转换与展开共用去重键；来源原文预览保留重复行。远程文件存在 wildcard 重复时触发托管 LIST，避免原文件直连绕过去重。


2026-10-29：RAW 支持可选 client；未指定时在目标客户端原样输出，旧客户端限定保持兼容。单条规则允许未收录类型与逻辑文本，不经过结构化规则解析 / 翻译；拒绝空白和换行。末尾 no-resolve / src 在 Lowering 拆分，拼接时排在出口之后，旧选项合并不重复。RAW wildcard 与结构化 wildcard 共用 mihomo lowercase 去重键。

## 订阅分流模式

`Profile.routing` 包含 `bound`（最新模板 + 按稳定组 ID 追加成员）和 `independent`（完整 groups/rules/final）两类。渲染统一调用 `resolveProfileRouting`；绑定组失效或合并成环为错误，独立配置不依赖模板。`routingConfig` 展开有效配置，`profileEditorOverlay` 仅为现有编辑器提供视图，不能作为第二份配置持久化。历史 `overlay` 入口用于旧数据迁移与兼容测试。


绑定订阅可选 `routing.prependRules` 保存有序单条规则，渲染先于全部模板规则，MATCH 沿用模板；缺省空数组。节点出口复用代理链的 wrap/copy/inline 依赖解析。模板更新检查前置规则 ID 与引用组，模式转换通过 resolveProfileRouting 保留完整顺序。


2026-10-29：规则及规则来源改为存在即生效。enabled 字段只供旧输入兼容，由服务端保存和 v17 迁移移除停用项并清除标记。处理链与仓库启停保持原语义。


2026-10-29 绑定规则页的说明与间距修正不涉及内核数据或渲染变更。

`USER-AGENT` 解析为独立 IR，保留大小写与通配值；Surge 正常输出，mihomo 按客户端不支持处理。来源解析诊断、客户端输出诊断分别计数。

Stash：renderStash 共用依赖与环路检测，按官方规则和节点字段生成 YAML。节点集按快照内联以保留筛选、代理链及空组 REJECT；Hysteria2 和延迟测试字段独立转换。exportStashConfig 将托管规则内嵌成可独立导入文件。官方依据见 docs/17-official-client-configuration-guides.md。

### 2026-10-29：统一名称搜索工具

`normalizeNameSearch`、`matchesNameSearch` 与 `nameLikePattern` 提供忽略大小写的字面包含匹配及 LIKE 参数转义，保留名称空格和标点。仅用于候选搜索，不改写节点精确匹配与处理链正则。

2026-10-29：`nameSearchRanges` 复用名称搜索的 NFKC、首尾空白与大小写规则，将命中映射为原始文本 UTF-16 半开区间，保留全角、兼容字符与组合字形，供分页候选高亮使用。领域模型与种子格式不变。
