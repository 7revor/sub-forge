# 04 · 客户端能力矩阵与输出映射

2026-11-02 按当前实现重写。本文描述本服务实际生成、转换和拒绝的行为，不把客户端原生能力清单或历史设计草案当作已实现功能。真机执行、版本要求与历史验证见 [19 · 转换说明](19-client-conversion.md)；基础原文契约见 [20](20-native-client-append.md)，处理器索引见 [21](21-multi-client-adapter-audit.md)。

## 1. 节点与 provider

四个输出目标都遵守来源的 `provider / inline` 设置，可以混用。处理链、前后缀、凭据与别名归一由服务端执行，上游私有地址不直接下发。

| 项目 | Mihomo | Surge | Loon | Stash |
| --- | --- | --- | --- | --- |
| 内联节点 | YAML proxies | Proxy 节点行 | Proxy 节点行 | YAML proxies，与 Mihomo 共用生成 |
| 引用来源 | proxy-providers＋use | 组 policy-path＋update-interval，多来源按序合成资源 | Remote Proxy＋组内订阅名，名称冲突分配别名 | 公共 proxy-providers＋use，保留 type: http、url、interval、proxy 字段 |
| 来源筛选 | 内联节点服务端筛选，动态 provider 保留组筛选表达 | 服务端筛选并生成稳定子集资源 | 同左 | 同左；include-all* 由服务端展开 |
| 代理链 | 节点 dialer-proxy，精确远程前置生成隐藏组 | 节点 underlying-proxy，不采用旧组级链草案 | 内联落地拆节点副本与 Proxy Chain；远程落地要求显式展开 | 与 Mihomo 共用前置、隐藏组、引用和循环校验，无专用跨 provider／网卡组合阻断 |
| 未适配节点参数 | 公共字段保留；block-quic 阻断值报错，关闭值省略 | 按 surgeProxyLine 映射，不能表达的项报错或诊断 | 按 loonProxyLine 映射，不能表达的项报错或诊断 | 不再维护协议／传输／扩展白名单；block-quic 原值保留 |
| Hysteria 字段 | 公共 password、up/down | 按 Surge 原生字段和单位转换 | 按 Loon 原生字段和单位转换 | Hysteria2 password→auth；Hysteria/Hysteria2 up/down→Mbps 的 up-speed/down-speed |

节点 provider 使用本服务地址且不附内容 version/hash；Mihomo／Stash 不写 path，由客户端管理缓存。内联、远程的节点别名冲突均报错，不覆盖另一份凭据或带宽。

依据：[公共生成](../packages/core/src/render/mihomo.ts)、[远程资源](../packages/core/src/render/remote-providers.ts)、[节点语义](../packages/core/src/render/node-semantics.ts)、[Surge 节点](../packages/core/src/render/surge-proxy.ts)、[Loon 节点](../packages/core/src/render/loon-proxy.ts)、[Stash 差异](../packages/core/src/render/stash-config.ts)。

## 2. 策略组

| 字段／行为 | Mihomo | Surge | Loon | Stash |
| --- | --- | --- | --- | --- |
| 组类型 | select／url-test／fallback／load-balance | 同名 | 同名 | 公共生成同名 |
| 动态成员 | 保留 include-all* | 服务端展开、筛选 | 同左 | 同左 |
| 测速 URL | 非 select 组 url；select 的结构化 URL 告警省略 | 非 select 测速下放节点 test-url | 组 url | 下放实际成员节点 benchmark-url，删除组 url |
| 单次测速超时 | 非 select 组 timeout，毫秒 | 非 select 下放节点 test-timeout，秒 | 写 General test-timeout，秒；与各组／基础原文冲突时报错 | 下放节点 benchmark-timeout，秒；删除组 timeout |
| 共享节点测速冲突 | 组内独立配置 | 报错 | 全局超时不一致报错 | 报错，包括 provider 实际选中节点 |
| load-balance 策略 | strategy 保留 | consistent-hashing→persistent=true，其余报错 | consistent-hashing→PCC、round-robin→Round-Robin，其余报错 | 公共生成保留，不设独立白名单 |
| 图标／隐藏 | icon／hidden | icon-url／hidden | img-url；hidden 告警省略 | 公共字段保留 |
| lazy／max-failed-times／expected-status | 非 select 按字段输出 | 告警省略 | lazy 告警省略，后两项报错 | 公共字段保留 |
| extra | 合并原字段 | 只接受 no-alert／evaluate-before-use／category／persistent | 拒绝策略组 extra，使用结构化字段 | 合并原字段，无专用白名单 |
| 空组 | REJECT；动态集合 empty-fallback=REJECT | 服务端筛空后 REJECT，空远程资源不成功下发 | 同左 | 同左，删除组 empty-fallback |

`maxTimeout` 结构化选项仅用于 Loon fallback／load-balance；其 `max-timeout` 未设置时目前复用组 timeout。Loon 拒绝 PASS。Surge／Loon 会读取 INI `proxy-test-url / test-timeout` 作为组默认值，组设置优先；这部分联动仍在使用。

依据：[公共组构造](../packages/core/src/render/mihomo.ts)、[Surge 组](../packages/core/src/render/surge-config.ts)、[Loon 组](../packages/core/src/render/loon-config.ts)、[Stash 测速](../packages/core/src/render/stash-config.ts)。

## 3. 规则映射

规则上下文仅含 `client`，不按 iOS／macOS 主动筛除进程规则，也不按客户端版本自动降级。无法表达的结构化规则诊断后跳过；逻辑子条件失败则整条跳过，不删掉子条件放宽匹配。

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


自定义改写按 `{ when: { client }, action }` 匹配，支持替换、删除和追加；不再接受 `when.platform`。示例：

```json
{
  "match": "PROCESS-NAME,Telegram",
  "override": {
    "when": { "client": "mihomo" },
    "action": { "replace": [{ "type": "RAW", "text": "PROCESS-NAME,org.telegram.messenger" }] }
  }
}
```

该改写作用于所有 Mihomo 输出，不区分操作系统。旧平台条件在迁移时停用并备份，不能简单删掉条件后扩大作用范围。

文本来源按来源／规则原顺序经 `prepareRuleDocument → convertRuleDocuments` 生成 classical LIST；注释、空行和诊断保留位置，跨来源去重，类别仅用于统计。YAML payload、域名列表和 CIDR 列表都会转换为文本托管，不再分桶重排，也不改用上游 URL。Loon 所有分流项都写 Remote Rule，Rule 段只保留 FINAL。

仅合法单一 MRS 来源可供 Mihomo／Stash 原字节托管，合并／改写／src 等不允许的组合明确报错；SRS 不支持。不提供通用二进制解码转换。

依据：[规则转换](../packages/core/src/rules/convert.ts)、[方言降级](../packages/core/src/rules/client.ts)、[交付决策](../packages/core/src/rules/delivery.ts)。

## 4. 基础设置：原文追加

当前基础配置没有公共字段到各内核的自动映射，没有预设 API。配置菜单分 Mihomo／Surge／Loon，输出目标仍包含 Stash。

- Mihomo／Surge／Loon：内核原文 → 应用原文。
- Stash：Mihomo 公共 → Stash 应用原文（v33 迁移退役旧 Stash 公共层）。
- YAML 映射递归合并、数组及标量后层替换；INI General／Host／MITM 按键覆盖，其余段追加。
- 保存保留原文；生成时检查语法与受管理段冲突，基础字段不做跨内核翻译或兼容过滤。
- `common / patch / surgePatch / stashPatch / loonPatch / raw / presetId` 仅在 v28 历史升级及旧种子导入边界转换；原文与备份兼容保留。`kernels.stash` 和隐藏应用追加仍有实际用途。

具体槽位、保存及继承规则见 [20](20-native-client-append.md)。

## 5. 目标识别、交付与缓存

URL 参数优先于 User-Agent；未知 UA 默认 Mihomo。应用／系统用于目标合法性、原文选择与主配置缓存，规则正文只按内核转换。主配置缓存区分 client／platform／app，公共规则身份只保留 client，并包含规则身份、处理参数与交付格式。

Surge 正式主配置写 `#!MANAGED-CONFIG`，Stash 写 `#SUBSCRIBED`。独立导出可内嵌 Surge／Stash 文本规则；Stash MRS 不能内嵌；含远程节点或 Loon 托管规则的草稿不能独立导出。公共规则内容版本升级后按需重新生成，地址保持不变，详见 [21](21-multi-client-adapter-audit.md)。

依据：[目标识别](../packages/server/src/client.ts)、[主配置](../packages/server/src/render.ts)、[公共规则](../packages/server/src/shared-rules.ts)。
