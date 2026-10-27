# 07 · 待核对清单（云端环境无法访问 / 无法实测的项）

> 云端环境访问不了 `manual.nssurge.com`、`wiki.metacubex.one`（mihomo 文档已改为克隆 MetaCubeX/Meta-Docs 核对），也不能执行 mihomo 二进制。
> 下列条目需要在本地电脑上查文档或实测。核对后请在 `[ ]` 处打勾，把结论写在"结论"列，并同步修改被引用的文档位置。

## A. Surge（manual.nssurge.com）

| # | 待核对 | 影响的文档 | 结论 |
| --- | --- | --- | --- |
| [ ] A1 | 组的 `policy-path` 参数名、能否指向返回 `[Proxy]` 格式的 URL、`update-interval` 写法 | 04 §1、§2 | |
| [ ] A2 | 一个组能否同时有多个 `policy-path`（我们假设只能有一个，需要拆子组再 `include-other-group`） | 04 §2 | |
| [ ] A3 | `policy-path` 中的节点能否被规则 / `underlying-proxy` / 其他组**按名称直接引用** | 06 §5-2 | |
| [ ] A4 | `policy-path` 内容中的节点写 `underlying-proxy=` 时，能否引用**主配置中的组或节点**（对应 mihomo 的"规则一"） | 06 §5-1 | |
| [ ] A5 | `underlying-proxy` 的值能否是**策略组**（而不仅是节点） | 04 §1、06 | |
| [ ] A6 | 组参数全集：`policy-regex-filter`、`include-all-proxies`、`include-other-group`、`hidden`、`no-alert`、`url`、`interval`、`timeout`、`tolerance`、`evaluate-before-use`、图标参数名 | 04 §2 | |
| [ ] A7 | load-balance 组是否存在、有无 strategy 类参数 | 04 §2 | |
| [ ] A8 | 无成员的组能否加载；`policy-regex-filter` 筛空时的行为（是否会**回退直连**，对应 mihomo 的 COMPATIBLE 风险） | 04 §2（TPL-10）、06 §5-3 | |
| [ ] A9 | `PROCESS-NAME` 是否支持完整路径、是否支持 `*` `?` 通配；iOS 上是否完全不可用 | 02 §4.5.4、04 §3.2 | |
| [ ] A10 | 是否支持 `DOMAIN-WILDCARD`；`NETWORK` 的对应规则（`PROTOCOL`？）；`SRC-IP`、`DEST-PORT` 写法；`IP-ASN`；`extended-matching` | 04 §3.1 | |
| [ ] A11 | `DOMAIN-SET` 与 `RULE-SET` 的格式差异（`.example.com` 前导点语义） | 04 §3.3 | |
| [ ] A12 | `[Host]` 能否按域名指定 DNS 服务器（对应 `nameserver-policy`） | 04 §4 | |
| [ ] A13 | Surge 不支持的协议列表（vless / reality / hysteria v1 / tuic / anytls / mieru 等的现状） | 04 §1 | |
| [ ] A14 | Surge iOS / macOS 的 UA 字符串格式（用于 CR-04 客户端识别） | 04 §5 | |
| [ ] A15 | 托管配置 `#!MANAGED-CONFIG` 的写法与更新间隔参数 | 新增到 04 | |

## B. mihomo 实测（本地执行二进制）

源码层面的结论见 06，需要用二进制验证：

| # | 用例 | 预期 | 结论 |
| --- | --- | --- | --- |
| [ ] B1 | 场景 1：前置在 provider（包装组），落地在本地 | `-t` 通过，流量经前置 | |
| [ ] B2 | 场景 2/3：落地在 provider（provider 内容中写 `dialer-proxy: 本地节点/组`） | `-t` 通过，流量经前置 | |
| [ ] B3 | 场景 5：前置和落地都在 provider（同源 / 异源各一份） | 同上 | |
| [ ] B4 | `override.dialer-proxy: <组名>` 整源走前置 | 同上 | |
| [ ] B5 | 包装组筛不出节点 + `empty-fallback: REJECT` | 连接被拒绝，不直连 | |
| [ ] B6 | provider 内 `dialer-proxy` 写一个不存在的名称 | `-t` 仍通过（证明 mihomo 不校验），运行时报 `not found` | |
| [ ] B7 | 主配置中只有 `proxies: [COMPATIBLE]` 的组 | `-t` 通过，面板中显示 | |
| [ ] B8 | http provider 的 URL 加 `?v=` 版本参数后重载主配置 | provider 重新下载 | |
| [ ] B9 | 包装组带 `hidden: true` 时，在 Clash Verge Rev / FlClash / Zashboard 等面板中确实不显示 | | |
| [ ] B10 | `PROCESS-NAME-WILDCARD` / `PROCESS-PATH-WILDCARD` 最早从哪个版本开始支持（决定是否要对旧内核降级） | | |

## C. FlClash / Clash Verge Rev / ClashMetaForAndroid（mihomo 系客户端）

| # | 待核对 | 结论 |
| --- | --- | --- |
| [ ] C1 | 各客户端拉取订阅时的 User-Agent（含平台信息吗？Android 版能否区分） | |
| [ ] C2 | 内置 mihomo 内核版本的更新节奏（决定我们能用哪些新字段，例如 `empty-fallback`） | |
| [ ] C3 | 是否会改写或忽略订阅中的 `proxy-providers` / `rule-providers` / `hidden` 字段 | |
| [ ] C4 | 是否读取 `subscription-userinfo` 响应头、`profile-update-interval`、`content-disposition` 文件名 | |
| [ ] C5 | FlClash 在 Android 上 `PROCESS-NAME` 是否匹配包名 | |

## D. Loon（P2，预留）

| # | 待核对 | 结论 |
| --- | --- | --- |
| [ ] D1 | 外部节点（`[Remote Proxy]`）与策略组引用外部节点的写法 | |
| [ ] D2 | 代理链写法（`[Proxy Chain]` 段？妙妙屋 `loon_template.go` 中有相关实现可参考思路） | |
| [ ] D3 | 规则集 `[Remote Rule]` 格式；是否支持进程规则 | |
| [ ] D4 | 组参数（filter / 正则筛选的写法） | |

## E. Stash（P2，预留）

| # | 待核对 | 结论 |
| --- | --- | --- |
| [ ] E1 | 对 Clash 配置的兼容范围：`proxy-providers`、`rule-providers`（behavior / format）、`dialer-proxy` 还是其他链式写法 | |
| [ ] E2 | 组字段支持：`use`、`filter`、`include-all`、`hidden` | |
| [ ] E3 | 进程规则（macOS 版） | |
| [ ] E4 | UA 字符串 | |

## F. 规则仓库（见 08）

| # | 待核对 | 结论 |
| --- | --- | --- |
| [ ] F1 | blackmatrix7 各变体的 behavior 建议：`X.yaml` / `X_Classical.yaml` / `X_Domain.yaml` / `X_No_Resolve.yaml` / Surge `X_Resolve.list`，以及 README 中"配置建议"的几种措辞 | |
| [ ] F2 | zydou 的 `@attr` 命名含义（`cn@!cn`、`@-!cn` 等）与 v2fly 属性语义的对应关系 | |
| [ ] F3 | zydou 中带尾部空格的文件名（如 `openai@ads .txt`）是否为上游构建 bug | |
| [ ] F4 | jsDelivr 对这两个仓库的可用性与缓存延迟（作为 raw.githubusercontent.com 的替代） | |
