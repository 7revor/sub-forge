# 04 · 客户端能力矩阵与输出映射（mihomo / Surge）

> mihomo 部分已对照官方文档（MetaCubeX/Meta-Docs）核对，关键行为经 v1.19.33 实测（[07 §2](07-verification-checklist.md#2-mihomo-实测)）。
> Surge 部分已对照 Surge 手册（2026-10）与 Surge Mac 6.9.1 的 `surge-cli --check` 核对（[07 §1](07-verification-checklist.md#1-surge)）。仍需运行时验证的条目标 ⏳。
> 最低支持版本见 [PRD §5](02-PRD.md#5-客户端兼容与订阅输出约定)。Loon / Stash / sing-box 预留，首期不实现。

## 1. 节点与 provider

| 能力 | mihomo | Surge | 输出策略 |
| --- | --- | --- | --- |
| 本地节点 | `proxies:` | `[Proxy]` | inline 输出 |
| 外部节点集 | `proxy-providers:`（`type: http`，指向 `/p/:token/:key`；**不写 `path`**，见 §1.1） | 组参数 `policy-path=<url>`，内容为逐行 `[Proxy]` 格式；`update-interval=<秒>`（默认 86400） | provider 输出（Q9：Surge 只用 `policy-path`） |
| provider 统一改写 | `override`（含 `dialer-proxy`、`additional-prefix/suffix`、`udp`、`skip-cert-verify` 等） | 组参数 `external-policy-modifier="k=v,..."`（只作用于 `policy-path` 成员）、`external-policy-name-prefix` | 改名、改参数一律在服务端处理链中完成，两端都不依赖客户端侧改写（06 §3） |
| provider 过滤 | provider 级 `filter` / `exclude-filter` / `exclude-type` | 组级 `policy-regex-filter` | 优先用服务端处理链，不依赖客户端过滤 |
| 链式代理（节点级） | 节点 `dialer-proxy: <组或节点名>`（`relay` 组已废弃） | 节点 `underlying-proxy=<节点或组名>`，只能写在 `[Proxy]` 中的节点上 | 见 03 §4 |
| 链式代理（整组） | 无；用 `override.dialer-proxy` 实现整源 | 组参数 `underlying-proxy=<节点或组名>`（iOS 5.22.0+ / Mac 6.9.0+），覆盖显式成员、`policy-path`、`include-*` 引入的全部成员；成员显示为 `Name (via X)` | 见 03 §4.3 |
| 不支持的协议 | — | 无 vless / reality、hysteria(v1)；tuic 只有 `tuic` / `tuic-v5` | Lowering 丢弃并写入 `report.dropped`，节点集预览按客户端标"不可用" |

### 1.1 mihomo provider 不写 `path`

http provider 不写 `path` 时，缓存路径由 URL 哈希决定，URL 一变（如 `?v=` 变化）客户端重载主配置即重新下载；显式写了 `path` 时，缓存文件在 `interval` 内不会重新下载（07 M8 实测）。REF-11 依赖前一种行为，因此 Lowering **不输出 `path`**。

### 1.2 Surge 协议对照

`http` / `https`、`h2-connect`（Mac 6.6.0+）、`socks5` / `socks5-tls`、`ss`、`snell`（v1–6）、`vmess`、`trojan`、`tuic` / `tuic-v5`、`hysteria2`、`masque`（iOS 5.22.0+ / Mac 6.9.0+）、`anytls`（iOS 5.17.0+ / Mac 6.4.3+）、`trust-tunnel`（Mac）、`ssh`、`wireguard`、`tailscale`（iOS 5.20.0+ / Mac 6.7.0+）、`external`（Mac，iOS 视为 REJECT）。

## 2. 策略组

| 字段（IR） | mihomo | Surge |
| --- | --- | --- |
| select / url-test / fallback / load-balance | 同名 | 同名（另有 `smart`、`subnet`，首期不使用） |
| 成员：组/节点 | `proxies: [...]` | 逗号列表 |
| 成员：节点集 | `use: [provider]` | `policy-path=`。一个组含多个节点集时：直接写多个 `policy-path` 是否都生效 ⏳（07 S1④）；在验证前，为每个节点集生成隐藏子组，父组用 `include-other-group` 合并 |
| 成员：其他组的全部成员 | 列组名（嵌套） | `include-other-group="g1,g2"`（递归展开） |
| 成员：全部节点 | `include-all` / `include-all-proxies` / `include-all-providers` | `include-all-proxies=true`（只含 `[Proxy]` 中的节点，不含外部节点和组） |
| filter | `filter` | `policy-regex-filter`（不作用于显式列出的成员） |
| exclude-filter | `exclude-filter` | 无 ⇒ 服务端预过滤，或转为负向前瞻合并进 `policy-regex-filter` |
| exclude-type | `exclude-type` | 无 ⇒ 服务端预过滤 |
| 测速地址 | 组级 `url` | **组级 `url` 已无效**；写入节点级 `test-url`（`external-policy-modifier="test-url=..."` 可批量设置外部节点），或使用 `[General] proxy-test-url` |
| 测速间隔 | `interval`（秒） | `interval`（秒，默认 600，结果有效期，懒测速） |
| 超时 | `timeout`（毫秒，单次测速超时） | **语义不同**：组级 `timeout`（秒）是"延迟低于该值才算可用"的筛选条件；单次测速超时对应节点级 `test-timeout` 或 `[General] test-timeout`（秒）。IR 的 `test.timeout` 输出为 Surge 节点级 `test-timeout`，不输出组级 `timeout` |
| tolerance | `tolerance`（毫秒） | `tolerance`（毫秒，默认 100，仅 url-test） |
| lazy / max-failed-times / expected-status | 同名 | 无（忽略并在报告中注明） |
| 首次使用前先测速 | 无 | `evaluate-before-use=true`（仅作为 Surge 高级参数） |
| hidden / icon | `hidden` / `icon` | `hidden` / `icon-url`（Mac 6.5.0+） |
| load-balance 策略 | `strategy: consistent-hashing / round-robin / sticky-sessions` | `persistent=true` 按目标主机名哈希（≈ consistent-hashing）；其余策略 ⇒ 不写 `persistent`（随机），报告中注明 |
| 防静默直连（包装组） | `empty-fallback: REJECT`（v1.19.27+） | 无对应参数 ⇒ D2 暂定写法：`Inner = select, policy-path=..., policy-regex-filter=^X$, hidden=true` + `__ref = fallback, Inner, REJECT, hidden=true` ⏳ |
| 空组（TPL-10） | 为空时=拒绝 ⇒ `proxies: [REJECT]`；为空时=直连 ⇒ `proxies: [COMPATIBLE]` | `select, REJECT` / `select, DIRECT`（Surge 不接受无成员无参数的组） |
| 其他 | `disable-udp`、`interface-name`、`routing-mark`、`default-selected` | `no-alert`（仅 url-test / fallback 生效）、`category`（iOS 5.23.0+ / Mac 6.10.0+） |

## 3. 规则映射

### 3.1 通用规则

| IR | mihomo | Surge |
| --- | --- | --- |
| DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD | 同名 | 同名 |
| DOMAIN-WILDCARD | `DOMAIN-WILDCARD`（v1.19.12+） | `DOMAIN-WILDCARD`（`*` 跨越点号，另支持 `[...]`）|
| DOMAIN-REGEX | `DOMAIN-REGEX` | 不支持 ⇒ 丢弃并告警（`URL-REGEX` 不等价，不自动转） |
| IP-CIDR / IP-CIDR6 (+no-resolve) | 同名 | 同名 |
| IP-ASN | `IP-ASN` | `IP-ASN`（十进制或 `AS` 前缀） |
| GEOIP | `GEOIP` | `GEOIP` |
| GEOSITE | `GEOSITE` | 不支持 ⇒ 若有对应规则集则替换为 RULE-SET / DOMAIN-SET，否则丢弃 |
| DST-PORT / SRC-PORT | `DST-PORT` / `SRC-PORT` | `DEST-PORT` / `SRC-PORT`（范围 `a-b`，比较运算符） |
| SRC-IP-CIDR | `SRC-IP-CIDR` | `SRC-IP`（支持 CIDR） |
| NETWORK | `NETWORK,tcp` / `NETWORK,udp` | `PROTOCOL,TCP` / `PROTOCOL,UDP`（**大小写敏感**；`TCP` 含 HTTP/HTTPS，`UDP` 含 QUIC/STUN） |
| AND / OR / NOT | 同名 | `AND,((R1),(R2)),Policy`，最大嵌套 10 层 |
| RULE-SET（规则集） | `RULE-SET,<provider>,<target>` + `rule-providers` | `RULE-SET,<url>,<target>`；纯域名集用 `DOMAIN-SET,<url>,<target>` |
| MATCH | `MATCH` | `FINAL`（必须是最后一条） |
| 规则选项 | `no-resolve`、`src` | `no-resolve`、`extended-matching`（域名类与 RULE-SET / DOMAIN-SET）；未知参数被 Surge 静默忽略 |

### 3.2 进程规则（语义化 `PROCESS` → 客户端）

| IR `PROCESS(kind, mode)` | mihomo | Surge macOS | Surge iOS |
| --- | --- | --- | --- |
| (name, exact) | `PROCESS-NAME,v` | `PROCESS-NAME,v` | 丢弃 |
| (path, exact) | `PROCESS-PATH,v` | `PROCESS-NAME,v`（以 `/` 开头即完整路径模式） | 丢弃 |
| (name, wildcard) | `PROCESS-NAME-WILDCARD,v`（v1.19.19+） | `PROCESS-NAME,v`（名称模式支持 `*` `?`） | 丢弃 |
| (path, wildcard) | `PROCESS-PATH-WILDCARD,v`（v1.19.19+） | `PROCESS-NAME,v`（路径模式支持 `*` `?`） | 丢弃 |
| (name, regex) | `PROCESS-NAME-REGEX,v` | 尝试正则→通配转换（仅当正则仅由字面量与 `.*` `.` 组成），否则丢弃 | 丢弃 |
| (path, regex) | `PROCESS-PATH-REGEX,v` | 同上 | 丢弃 |

注意：

- Surge 进程规则**区分大小写**，仅 macOS 生效；iOS 会忽略这些规则（不报错），我们仍主动丢弃以保持输出干净。
- Surge 另有 App Bundle 模式（Mac 6.0.0+）：值以 `/` 开头且以 `/` 结尾，按路径前缀匹配，如 `PROCESS-NAME,/Applications/ChatGPT.app/`。IR `(path, wildcard, "/Applications/X.app/*")` 可等价输出为该写法。
- mihomo 的 `*-WILDCARD` 只支持 `*`、`?`，与配置文件其他地方的 Clash 域名通配符语义不同（官方文档明确说明）。
- mihomo 在 Android 上 `PROCESS-NAME*` 匹配的是**包名**（⏳ 07 C5 待实测），因此同一条"Telegram"规则在 Android 上需要写 `org.telegram.messenger`。这正是 CR-02"按 platform 覆盖"的典型用例：
  ```
  PROCESS(name, exact, "Telegram")
    overrides: [{ when: { client: mihomo, platform: android }, replace: [PROCESS(name, exact, "org.telegram.messenger")] }]
  ```
- mihomo 需要 `find-process-mode` 不为 `off`，进程规则才生效（BS-05 告警）。
- 导入外部规则集时，解析器把 `PROCESS-NAME/PROCESS-PATH/*-REGEX/*-WILDCARD` 统一转回语义化 IR；Surge 的 `PROCESS-NAME` 若值以 `/` 开头视为 path，包含 `*` `?` 视为 wildcard。

### 3.3 规则集格式

| 来源格式 | 解析 | mihomo 输出 | Surge 输出 |
| --- | --- | --- | --- |
| classical 文本（Surge/Clash 通用） | ✅ | `behavior: classical, format: text`（或 yaml） | RULE-SET |
| mihomo YAML `payload:` | ✅ | 按 behavior 原样 | 转 RULE-SET / DOMAIN-SET |
| Surge DOMAIN-SET | ✅ | `behavior: domain`（`.example.com` → `+.example.com`；无前导点 → 精确匹配） | DOMAIN-SET |
| 纯 CIDR 文本 | ✅ | `behavior: ipcidr` | RULE-SET（逐行加 `IP-CIDR,`） |
| mrs | ❌ 透传 | 原 URL，`format: mrs`（v1.18.7+，规则仓库默认，R3） | 不可用 ⇒ 报告 |
| sing-box json | P2 | — | — |
| srs | ❌ 透传 | 不可用 | 不可用 |

Surge 规则集约束：

- RULE-SET 文件中不允许 `FINAL` 和 `pre-matching`；可以包含 `PROCESS-NAME`（内置 `SYSTEM` 集即有）。逻辑规则能否出现在 RULE-SET 中，手册未明确 ⏳。
- **同一 URL 不能在一份配置中同时用作 RULE-SET 和 DOMAIN-SET**。规则包拆分（03 §6）输出的 domain / classical 两个地址天然不同，不受影响；同一个规则集被不同条目以不同方式引用时，Lowering 需统一为一种。
- 单个集合上限 100 万条；RULE-SET 行可带 `no-resolve`、`extended-matching`、`update-interval=<秒>`。

## 4. 基础设置映射（节选）

| IR | mihomo | Surge |
| --- | --- | --- |
| ipv6 | `ipv6` | `ipv6` |
| log level | `log-level` | `loglevel` |
| DNS 上游 | `dns.nameserver` | `dns-server`（IP 或 `system`）/ `encrypted-dns-server`（URL） |
| 按域名指定 DNS | `dns.nameserver-policy` | `[Host]` 中 `domain = server:8.8.8.8`；多个服务器逗号分隔（iOS 5.21.0+ / Mac 6.8.0+）；可绑定规则集 `DOMAIN-SET:<url> = server:...`（Mac 5.10.0+）。注意 `[Host]` 通配是纯字符串匹配：`*google.com` 也匹配 `bargoogle.com`，`nameserver-policy` 的 `+.google.com` 应输出为 `google.com` 与 `*.google.com` 两行 |
| fake-ip | `dns.enhanced-mode: fake-ip` + `fake-ip-range` + `fake-ip-filter` | Surge 增强模式默认 fake-ip；`always-real-ip` 对应 fake-ip-filter |
| DNS 劫持 | `dns.listen` / `tun.dns-hijack` | `hijack-dns`（如 `*:53`） |
| 绕过 | — | `skip-proxy` / `tun-excluded-routes` |
| 测速地址 | 组级 `url` | `proxy-test-url`（默认 `http://bing.com/`）/ `internet-test-url`（DIRECT 用）；HTTPS 需 iOS 5.23.0+ / Mac 6.10.0+ |
| 测速超时 | 组级 `timeout`（毫秒） | `test-timeout`（秒，默认 5） |

基础设置没有完美的一一映射，因此 **BaseSettings 按客户端分别编辑**（每个预设含 mihomo 段与 Surge 段），IR 只抽象最常用的十几项用于"快速设置"表单。

## 5. 客户端识别（CR-04）

| UA 特征（示例） | 识别为 |
| --- | --- |
| `mihomo` / `clash.meta` / `Clash-Verge` / `FlClash` / `ClashMetaForAndroid` | mihomo；`ClashMetaForAndroid`、Android 版 FlClash ⇒ platform=android |
| `Surge iOS` / `Surge Mac` | surge；platform 与版本由 UA 区分 |
| 其他 | 默认 mihomo，记录 UA 以便后续补充 |

URL 参数 `?target=&platform=` 优先于 UA。各客户端 UA 原文 ⏳（07 S12②、C1），识别规则在采集后补全。


2026-10-29：mihomo 的 PROCESS-NAME-WILDCARD、PROCESS-PATH-WILDCARD 与 DOMAIN-WILDCARD 在合并转换中按小写键去重，保留首条输出原文；Surge 不作此归一化。实现依据：[mihomo 进程匹配源码](https://github.com/MetaCubeX/mihomo/blob/Meta/rules/common/process.go) 与 [域名 wildcard 源码](https://github.com/MetaCubeX/mihomo/blob/Meta/rules/common/domain_wildcard.go)。本次不扩展精确或正则规则的去重范围。
