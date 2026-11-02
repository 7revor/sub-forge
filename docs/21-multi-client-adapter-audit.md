# 多平台差异处理器复审与缓存修复总结

审查日期：2026-11-02。源码基线：`331d003`；公共规则缓存修复：`4711cba`。本文合并首次 30 组处理器审查与 Stash 精简后的复审结论，以当前实现为准。历史审查中的 Stash 白名单、强制内联、链路专用阻断、URL-REGEX 丢弃及 provider.type 删除描述已不适用。

本文核对代码和自动测试，不重新声明各客户端的最新能力；字段透传不等于真机验证通过。

## 1. 总体结论

1. **通用基础配置跨端映射已退出正常生成。** 正常路径按内核／应用保存原文，执行结构合并、目标校验和受管理段冲突检查。旧映射只供数据库 v28 升级和旧种子导入使用。
2. **节点、策略组、代理链与规则的差异处理仍是有效功能。** Stash 与 Mihomo 已共用 Clash 生成入口，Stash 差异收敛为字段／单位、测速、托管成员与空组保护、规则方言、历史继承与交付等职责。
3. **公共规则缓存缺陷已修复。** 内容版本由 2 升为 3；旧链接和资源身份保持不变，下次服务端读取重建正文。
4. **初审的 R01–R06 尚未清理。** 其中一项是旧规则管线，其余是提示、注释、文档或测试残留。本文没有顺带删除它们，也没有取消历史数据支持。
5. **三组产品菜单、四个输出目标仍并存。** Stash 在产品菜单归入 Mihomo，但规则改写和产物身份继续区分 Stash；这不是误留的枚举。

## 2. 本次缓存修复

入口：[SharedRuleService](../packages/server/src/shared-rules.ts)、[资源下载路由](../packages/server/src/resource-files.ts)。

旧内容哈希包含来源、规则定义、目标内核和处理参数，但转换版本仍为 2。Stash 已开始保留 `URL-REGEX`，旧缓存却仍可能返回“尚未适配”的诊断注释；主配置的 `clashDelivery` 保护不覆盖公共规则表。

修复采用独立的 `SHARED_RULE_RENDER_VERSION = 3`，只进入内容哈希，不进入资源 key。已有 `key` 链接与按 `id` 选择目标的链接均自动受益，无需删除规则、修改来源、重新保存订阅或批量清空数据库。首次读取重新编译，成功写回后继续命中缓存。版本为公共值，其他目标的旧公共规则也会按需重建一次。

失败策略保持：有成功正文时，重建失败继续返回旧正文并携带 `x-sub-forge-warning: last-good-rule`；旧内容哈希不升级，后续仍会重试。该修复不能主动清除客户端本地文件，须在合并并运行新代码后，由客户端再次请求资源才生效。

[升级回归测试](../packages/server/test/shared-rule-cache-version.test.ts) 固定预置 version 2 的旧正文，不用当前 `register` 伪造历史版本，覆盖：

- 已发布 key 链接和 id 链接在来源不变时生成新的 `URL-REGEX` 正文。
- 资源 key、记录数量不变；两种入口后续读取不重复写缓存。
- 重建失败保留旧正文和旧哈希；恢复原输入后重新编译并清除告警。

## 3. Stash 精简后的实际边界

公共入口为 [renderClash](../packages/core/src/render/mihomo.ts)，`renderMihomo`、`renderStash` 为薄包装；节点、组、来源、引用与代理链共用生成和校验。

| 范围 | 当前转换、过滤或降级 | 精简后的变化 |
| --- | --- | --- |
| 节点字段与单位 | Hysteria2 `password → auth`；Hysteria/Hysteria2 `up/down → up-speed/down-speed`，转为 Mbps；输入别名先统一，冲突报错 | 不再维护协议、传输或扩展字段白名单；`smux`、`ip-version`、`routing-mark` 等按公共生成保留；`block-quic` 原值保留 |
| 测速 | 组 URL／timeout 传播到实际选中节点的 `benchmark-url / benchmark-timeout`，毫秒转秒；覆盖内联和 provider 节点；共享节点值冲突报错 | 组级 `url / timeout` 删除；不再对组扩展、`sticky-sessions / max-failed-times / expected-status` 设 Stash 专用白名单 |
| 动态成员与远程资源 | 展开 `include-all*`；包含／排除正则、类型排除和精确远程节点在服务端筛选；生成稳定子集资源；筛空组用 REJECT；空原始资源不下发 | 继续尊重每个来源的 provider／inline 选择；保留公共 provider 字段；删除生成组的 `empty-fallback` 与已由服务端执行的筛选字段 |
| 代理链 | 共用前置选择、隐藏组名称、精确远程节点引用、依赖和循环校验 | 已删除同 provider／跨 provider 专用阻断及网卡与 dialer 组合阻断，不另建 Stash 链实现 |
| 规则方言 | URL-REGEX、USER-AGENT 正常输出；端口集合转 OR；源 CIDR 转 SRC-IP；简单进程名称正则转通配；不能等价表达的规则给诊断并跳过 | 仍拒绝源 ASN/GEOIP、路径通配／路径正则、非 Surge 的 extended-matching；逻辑子条件失败整条跳过，不放宽匹配 |
| 原文继承、缓存与交付 | Mihomo 公共 → 历史 Stash 公共 → Stash 应用追加；主配置含 `#SUBSCRIBED`；公共规则版本按本次修复更新；文本规则可独立内嵌 | 保留独立应用与产物身份；MRS 不能内嵌到独立文本；含远程节点的草稿导出受限；主配置禁止回退旧专用生成结果 |

实现依据：[节点语义](../packages/core/src/render/node-semantics.ts)、[Stash 最末层适配](../packages/core/src/render/stash-config.ts)、[远程节点](../packages/core/src/render/remote-providers.ts)、[规则方言](../packages/core/src/rules/client.ts)、[主配置交付与缓存](../packages/server/src/render.ts)。基础原文不套节点／组白名单，不会自动剔除 Mihomo 专属基础字段。

## 4. 30 组处理器更新清单

编号沿用初审，按职责归类，不代表代码中存在 30 个独立类或注册器。普通重命名、排序等无目标客户端参数的处理链不计入。

| 编号 | 处理器／位置 | 当前各端差异与处理 |
| --- | --- | --- |
| A01 | [types / base/native](../packages/core/src/base/native.ts)：身份和产品分组 | 四输出 Mihomo／Surge／Stash／Loon，三组产品菜单；区分 YAML／INI；应用原文独立 |
| A02 | [server/client](../packages/server/src/client.ts)：UA 与参数识别 | 参数优先；clash 别名归 Mihomo；默认 Mihomo；应用与内核／系统匹配；Apple 应用推断 |
| A03 | [server/render](../packages/server/src/render.ts)：目标归一和 API 校验 | 各端目标组合校验；非 Mihomo 的显式系统只允许 iOS／macOS；多入口仍各有校验 |
| A04 | [base/native](../packages/core/src/base/native.ts)：原文继承 | Mihomo／Surge／Loon 按内核→应用；Stash 额外承接历史 Stash 公共原文 |
| A05 | [base/native](../packages/core/src/base/native.ts)：原文合并 | YAML 递归映射合并、数组整体替换；INI General／Host／MITM 按键覆盖，其余追加；拒绝受管理段；INI 测速值仍供生成联动 |
| A06 | [native-migration](../packages/server/src/native-migration.ts)：旧公共映射 | 仅 v28 升级／旧种子导入；展开 common／patch／raw／旧预设；停用并备份旧平台规则条件 |
| A07 | [proxy/parse](../packages/core/src/proxy/parse.ts)：节点输入 | Clash YAML、Surge／Loon 节点行、URI／base64 转统一节点；不恢复整份基础配置导入 |
| A08 | [proxy/clientJson](../packages/core/src/proxy/clientJson.ts)：JSON 节点输入 | sing-box、Xray／V2Ray、VMess 分享 JSON；TLS／Reality／传输／detour 映射 |
| A09 | [node-semantics](../packages/core/src/render/node-semantics.ts)：公共节点语义 | 凭据／带宽别名、VLESS／VMess sni 归一并检查冲突；仅 Mihomo 对 block-quic 阻断值报错、关闭值省略；Stash 保留 |
| A10 | [surge-proxy](../packages/core/src/render/surge-proxy.ts)：Surge 节点 | 协议、认证、TLS、WS、混淆、带宽、跳跃端口、IP 模式、链路与指纹转换；未适配项按实现报错或诊断 |
| A11 | [loon-proxy](../packages/core/src/render/loon-proxy.ts)：Loon 节点 | 位置凭据、SS(R)、VLESS／Reality、传输、端口范围、IP 模式、布尔 block-quic、TLS 指纹；原始 dialer 不能直接写节点行 |
| A12 | [stash-config](../packages/core/src/render/stash-config.ts)：Stash 节点 | 只保留 Hysteria 字段与带宽单位转换；协议／传输／扩展白名单已移除 |
| A13 | [mihomo](../packages/core/src/render/mihomo.ts)／[remote-providers](../packages/core/src/render/remote-providers.ts)：来源与筛选 | 四端遵守 provider／inline；Mihomo 保留动态引用；另外三端托管筛选，Surge 多来源合成 policy-path、Loon 远程订阅命名避冲突、Stash 输出公共 YAML provider |
| A14 | [mihomo](../packages/core/src/render/mihomo.ts)：代理链 | Mihomo／Stash 同一 dialer 与隐藏组；Surge 转 underlying-proxy；Loon 拆落地副本＋Proxy Chain，远程落地需显式展开 |
| A15 | [mihomo](../packages/core/src/render/mihomo.ts)：策略组公共构造 | 筛选、动态成员、REJECT 兜底；Mihomo／Stash 合并 extra；Surge 仅指定 extra；Loon 拒绝 extra；maxTimeout 仅 Loon 对应组接受，Loon 拒绝 PASS |
| A16 | [surge-config](../packages/core/src/render/surge-config.ts)：Surge 组 | 非 select 测速参数落到节点、毫秒转秒；共享节点冲突报错；图标／负载均衡映射；lazy／max-failed-times／expected-status 告警省略 |
| A17 | [loon-config](../packages/core/src/render/loon-config.ts)：Loon 组 | 超时写全局并检查冲突；PCC／Round-Robin、img-url、max-timeout；lazy／hidden 告警省略，max-failed-times／expected-status 报错 |
| A18 | [stash-config](../packages/core/src/render/stash-config.ts)：Stash 测速 | 实际成员节点写 benchmark 字段、毫秒转秒；冲突报错；删除组 url／timeout／empty-fallback；无组扩展白名单 |
| A19 | [rules/parse](../packages/core/src/rules/parse.ts)／[remote](../packages/core/src/rules/remote.ts)：规则输入 | PROCESS、SRC-IP、DEST-PORT、PROTOCOL 等方言归一；Clash／Surge 域名前导点区分 |
| A20 | [rules/convert](../packages/core/src/rules/convert.ts)／[client](../packages/core/src/rules/client.ts)：用户改写 | 四端按 client 命中首条替换／删除／追加；不匹配 platform／app；旧 source.overrides 仍参与 |
| A21 | [rules/client](../packages/core/src/rules/client.ts)：规则降级 | 四端具体差异见下表；不支持时诊断跳过；任一逻辑子条件失败，整条跳过 |
| A22 | [rules/parse](../packages/core/src/rules/parse.ts)：去重键 | 仅 Mihomo wildcard 键忽略大小写，保留首条原文；Stash 仍不做该键归一 |
| A23 | [rules/delivery](../packages/core/src/rules/delivery.ts)：规则交付 | 文本统一 classical LIST；合法单源 MRS 仅 Mihomo／Stash 托管；SRS 拒绝；Loon 手写规则也转远程 |
| A24 | [rules/expand](../packages/core/src/rules/expand.ts)：旧展开／分桶 | expandSource／expandRuleSet 仅仓库内测试调用，待清理；sourceKey、RuleSetInputs、formatRuleLine 等仍有现用调用，不能整文件删除 |
| A25 | [rule-repos/adapters](../packages/server/src/rule-repos/adapters.ts)：仓库变体 | 区分 Clash／Surge 路径、纯域名格式；选择推荐变体，属于输入源适配 |
| A26 | [surge-config](../packages/core/src/render/surge-config.ts)／[loon-config](../packages/core/src/render/loon-config.ts)：序列化 | YAML 输出 Mihomo／Stash；INI 引用转义、MATCH→FINAL；Surge RULE-SET、Loon Remote Rule／Remote Proxy／Proxy Chain |
| A27 | [server/render](../packages/server/src/render.ts)：独立导出 | Surge／Stash 可内嵌文本规则；Stash MRS 不可内嵌；Loon 含托管规则不可草稿导出；含远程节点时使用保存后的正式链接 |
| A28 | [server/render](../packages/server/src/render.ts)：主配置交付／缓存 | Stash `#SUBSCRIBED`、Surge `#!MANAGED-CONFIG`；主缓存隔离 client／platform／app；拒绝旧内联、旧 Stash 或不同节点输出设置的 last-good；仅 Mihomo 有可选校验器 |
| A29 | [shared-rules](../packages/server/src/shared-rules.ts)：公共规则身份／缓存 | 目标只按 client，处理参数和交付格式另参与身份；舍弃 platform／app；本次补齐内容版本失效，保持旧链接 |
| A30 | [RulesetPreview](../packages/web/src/components/RulesetPreview.tsx)／[ClientOverrides](../packages/web/src/components/ClientOverrides.tsx)：UI 候选 | 规则预览三目标、改写四目标；Stash 可改写但规则集预览不能单选；完整订阅仍可预览 Stash |

## 5. 规则转换速查

以下描述结构化规则及规则集转换；RAW／本地原文另走显式透传入口。“跳过”会保留诊断，不等同于整份订阅失败。依据：[rules/client.ts](../packages/core/src/rules/client.ts)、[rules/convert.ts](../packages/core/src/rules/convert.ts)。

| 输入 | Mihomo | Surge | Loon | Stash |
| --- | --- | --- | --- | --- |
| DOMAIN／SUFFIX／KEYWORD／WILDCARD | 同名 | 同名 | 同名，wildcard 附版本提示 | 同名 |
| DOMAIN-REGEX／GEOSITE | 同名 | 跳过 | 跳过 | 默认同名透传 |
| USER-AGENT／URL-REGEX | 跳过 | 同名 | 同名 | **同名，URL-REGEX 已恢复** |
| IP-CIDR／CIDR6／ASN／GEOIP | 同名＋no-resolve | 同左 | 同左 | 同左 |
| CIDR 的 src／SRC-IP-CIDR | 保留 src／同名 | SRC-IP | 整条跳过 | SRC-IP，附版本提示 |
| ASN／GEOIP 的 src | 保留 | 跳过 | 跳过 | 跳过 |
| DST-PORT 斜杠集合 | 同名保留集合 | DEST-PORT，集合→OR | DEST-PORT，集合→OR | DST-PORT，集合→OR |
| SRC-PORT 斜杠集合 | 同名保留集合 | SRC-PORT，集合→OR | SRC-PORT，集合→OR | SRC-PORT，集合→OR，附版本提示 |
| NETWORK | NETWORK,tcp/udp | PROTOCOL,TCP/UDP | PROTOCOL,TCP/UDP | NETWORK,tcp/udp |
| 进程名称／路径精确和通配 | NAME／PATH 与 WILDCARD 变体 | PROCESS-NAME | PROCESS-NAME；拒绝以 `/` 结尾的路径；提示名称大小写差异 | 名称 PROCESS-NAME；路径仅精确 PROCESS-PATH，路径通配跳过 |
| 进程正则 | NAME／PATH-REGEX | 简单正则转通配，否则跳过 | 可转通配且符合路径限制才输出 | 名称可转简单通配才输出；路径正则跳过 |
| extended-matching | 整条跳过 | 仅实现允许的域名／URL-REGEX／RAW 类型 | 整条跳过 | 整条跳过 |
| AND／OR／NOT | 递归；任一子条件无法表达则整条跳过 | 同左 | 同左 | 同左 |
| RAW／本地原文 | 校验单行及可选 client 限定后透传，不自动翻译正文 | 同左 | 同左，最终远程托管 | 同左 |
| MRS／SRS | 合法单源 MRS 托管；SRS 拒绝 | 均拒绝 | 均拒绝 | 合法单源 MRS 托管；SRS 拒绝 |

规则不再按 iOS／macOS 主动筛除 PROCESS；旧 `when.platform` 只走迁移，正常保存拒绝。部分说明仍引用旧行为，见 R04／R05。

## 6. 尚未解决的遗留项

| 编号 | 当前发现 | 后续建议 |
| --- | --- | --- |
| R01 | [expand.ts](../packages/core/src/rules/expand.ts) 的 expandSource／expandRuleSet 和专用分桶类型没有仓库内生产调用，仍公开导出 | 删除前收紧导出，将有价值断言迁到 convertRuleDocuments；保留现用类型／工具，仓库外消费者未调查 |
| R02 | [RulesetOverrides](../packages/web/src/components/RulesetOverrides.tsx) 仍提示“所有内核输出相同规则” | 改为“暂无自定义改写，按目标内核自动转换。” |
| R03 | [legacy-common-base](../packages/server/src/legacy-common-base.ts) 注释仍写仅用于 v25 | 改为 v28 升级与旧种子导入；不能据注释判断成死代码 |
| R04 | [04-client-matrix](04-client-matrix.md) 仍写 Surge iOS 丢弃进程规则、platform 改写和旧公共字段映射 | 重写现行矩阵或标注历史版本 |
| R05 | [server README](../packages/server/README.md)、[PRD](02-PRD.md) 等仍留 base.raw 不输出、preset.stash／stashPatch 和旧验收 | 当前说明改为原文槽位和按内核转换；历史记录明确适用版本 |
| R06 | [rules.test](../packages/core/test/rules.test.ts) 的 mac 变量仅传 client:surge，存在同目标重复断言 | 与 R01 一起迁移；不能将旧命名当作平台覆盖证据 |

本次另修正了 [19-client-conversion](19-client-conversion.md) 中仍将 Stash 与 Mihomo 一并拦截 block-quic 的过时描述，并明确主配置与公共规则的不同失败策略。

仍需产品审查的边界：

- 规则集预览三目标、规则改写四目标的入口不一致。
- 历史 `kernels.stash`、隐藏的 FlClash／Clash Verge 原文仍参与继承；取消前需要数据迁移。
- 主配置缓存保留 platform 维度，公共规则只按 client；是否合并重复主缓存应单独验证。
- INI `proxy-test-url / test-timeout` 仍会影响组／节点；原文并非完全不解释。
- Loon fallback／load-balance 的 `max-timeout` 缺省取 `group.timeout`，两个字段语义是否继续联动需单独决定。

仍有用途的历史代码：`CommonBase / lowerCommonBase / mergeBase` 供迁移；平台改写停用前有加密备份；`source.overrides` 仍被正式转换读取；`stringifyIniBase` 仍供当前 INI 序列化和 Loon 测速使用。不能把这些与 R01 一并删除。

## 7. 本轮验证与交付状态

- 新增升级回归 3 项：未修复时全部因返回旧注释正文而失败，修复后全部通过，随后纳入服务端全量测试。
- 服务端全量：77 个文件通过、2 个文件按环境跳过；665 项通过、5 项跳过。
- Core 定向：6 个文件通过；83 项通过、1 项跳过。
- 合计 **748 项通过、6 项跳过**，新增用例不重复计数；服务端类型检查通过。
- 服务端跳过项需要 `MIHOMO` 及部分场景的 `MIHOMO_RUNTIME=1`；Core 跳过项需要 `SURGE_BIN`。本轮未执行客户端真机导入、实际代理转发、浏览器验收或前端构建。
- 在独立工作树复用本机已安装依赖执行，没有安装依赖或浏览器，没有运行项目开发服务。测试进程结束后清理临时依赖链接。
- 修改本地提交，未合并主分支、未推送、未部署；保留工作树供审查。

```sh
pnpm --filter @sub-forge/server test
pnpm --filter @sub-forge/server typecheck
pnpm --filter @sub-forge/core test test/clash-common.test.ts test/stash-render.test.ts test/remote-providers.test.ts test/node-semantics.test.ts test/native-base.test.ts test/rule-convert.test.ts
```
