# 04 · 客户端能力矩阵与输出映射（mihomo / Surge）

> mihomo 部分已对照官方文档（MetaCubeX/Meta-Docs）核对。
> Surge 部分基于既有知识整理，标注 ⚠ 的条目在实现前需对照 Surge 官方手册（manual.nssurge.com）再核对一次。
> Loon / Stash / sing-box 预留列，首期不实现。

## 1. 节点与 provider

| 能力 | mihomo | Surge | 输出策略 |
| --- | --- | --- | --- |
| 本地节点 | `proxies:` | `[Proxy]` | inline 输出 |
| 外部节点集 | `proxy-providers:`（`type: http`，指向 `/p/:token/:key`） | 组参数 `policy-path=<url>` ⚠ | provider 输出 |
| provider 统一改写 | `override`（含 `dialer-proxy`、`additional-prefix/suffix`、`udp`、`skip-cert-verify` 等） | 无等价物 ⚠ | Surge 下在 policy-path 内容中直接改写 |
| provider 过滤 | provider 级 `filter` / `exclude-filter` / `exclude-type` | `policy-regex-filter`（组级） | 优先用我们自己的处理链，不依赖客户端过滤 |
| 链式代理 | 节点 `dialer-proxy: <组或节点名>`（`relay` 组已废弃） | 节点 `underlying-proxy=<名>` ⚠ | 见 03 §4 |
| 不支持的协议 | 由 Lowering 丢弃并告警（如 Surge 不支持 vless/hysteria(v1)/tuic v4 等，以实际为准 ⚠） | | report.dropped |

## 2. 策略组

| 字段（IR） | mihomo | Surge |
| --- | --- | --- |
| select / url-test / fallback / load-balance | 同名 | `select` / `url-test` / `fallback` / `load-balance` |
| 成员：组/节点 | `proxies: [...]` | 逗号列表 |
| 成员：节点集 | `use: [provider]` | `policy-path=` ⚠（一个组只能有一个 policy-path，多个节点集需拆子组再 `include-other-group`） |
| 成员：其他组的全部成员 | 列组名（嵌套）| `include-other-group=` |
| 成员：全部节点 | `include-all` / `include-all-proxies` / `include-all-providers` | `include-all-proxies=true` |
| filter | `filter` | `policy-regex-filter` |
| exclude-filter | `exclude-filter` | 无 ⇒ 转为负向前瞻正则合并进 `policy-regex-filter`，或在服务端预过滤 |
| exclude-type | `exclude-type` | 无 ⇒ 服务端预过滤 |
| url / interval / timeout / tolerance | 同名 | `url` / `interval` / `timeout` / `tolerance` |
| lazy / max-failed-times / expected-status | 同名 | 无（忽略并在报告中注明）；Surge 有 `evaluate-before-use` ⚠ |
| hidden / icon | `hidden` / `icon` | `hidden` / 无 icon（Surge 用 `icon-url`? ⚠）|
| load-balance strategy | `strategy` | ⚠ |
| 其他 | `disable-udp`、`interface-name`、`routing-mark`、`default-selected`、`empty-fallback` | `no-alert` 等 |

| 空组（TPL-10） | `proxies: [COMPATIBLE]` | `select, DIRECT` ⚠（需核对 Surge 是否接受无成员的组） |

> 实现建议：Surge 的"一个组一个 policy-path"限制意味着当一个组包含多个节点集时，Lowering 需要为每个节点集生成隐藏子组，再在父组中 `include-other-group`。这一点对用户透明。

## 3. 规则映射

### 3.1 通用规则

| IR | mihomo | Surge |
| --- | --- | --- |
| DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD | 同名 | 同名 |
| DOMAIN-WILDCARD | `DOMAIN-WILDCARD` | `DOMAIN-WILDCARD` ⚠ |
| DOMAIN-REGEX | `DOMAIN-REGEX` | 不支持 ⇒ 丢弃 / `URL-REGEX` 不等价，不自动转 |
| IP-CIDR / IP-CIDR6 (+no-resolve) | 同名 | 同名 |
| IP-ASN | `IP-ASN` | `IP-ASN` |
| GEOIP | `GEOIP` | `GEOIP` |
| GEOSITE | `GEOSITE` | 不支持 ⇒ 若有对应规则集则替换为 RULE-SET，否则丢弃 |
| DST-PORT / SRC-PORT | `DST-PORT` / `SRC-PORT` | `DEST-PORT` / `SRC-PORT` |
| SRC-IP-CIDR | `SRC-IP-CIDR` | `SRC-IP` |
| NETWORK | `NETWORK` | `PROTOCOL` ⚠ |
| AND / OR / NOT | 同名 | 同名 |
| RULE-SET（规则集） | `RULE-SET,<provider>,<target>` + `rule-providers` | `RULE-SET,<url>,<target>`；纯域名集用 `DOMAIN-SET,<url>,<target>` |
| MATCH | `MATCH` | `FINAL` |

### 3.2 进程规则（语义化 `PROCESS` → 客户端）

| IR `PROCESS(kind, mode)` | mihomo | Surge macOS | Surge iOS |
| --- | --- | --- | --- |
| (name, exact) | `PROCESS-NAME,v` | `PROCESS-NAME,v` | 丢弃 |
| (path, exact) | `PROCESS-PATH,v` | `PROCESS-NAME,v`（Surge 接受完整路径）| 丢弃 |
| (name, wildcard) | `PROCESS-NAME-WILDCARD,v` | `PROCESS-NAME,v`（通配符）⚠ | 丢弃 |
| (path, wildcard) | `PROCESS-PATH-WILDCARD,v` | `PROCESS-NAME,v`（通配符）⚠ | 丢弃 |
| (name, regex) | `PROCESS-NAME-REGEX,v` | 尝试正则→通配转换（仅当正则仅由字面量与 `.*` `.` 组成），否则丢弃 | 丢弃 |
| (path, regex) | `PROCESS-PATH-REGEX,v` | 同上 | 丢弃 |

注意：

- mihomo 的 `*-WILDCARD` 只支持 `*`、`?`，与配置文件其他地方的 Clash 域名通配符语义不同（官方文档明确说明）。
- mihomo 在 Android 上 `PROCESS-NAME*` 匹配的是**包名**，因此同一条"Telegram"规则在 Android 上需要写 `org.telegram.messenger`。这正是 CR-02"按 platform 覆盖"的典型用例：
  ```
  PROCESS(name, exact, "Telegram")
    overrides: [{ when: { client: mihomo, platform: android }, replace: [PROCESS(name, exact, "org.telegram.messenger")] }]
  ```
- mihomo 需要 `find-process-mode` 不为 `off`，进程规则才生效（BS-05 告警）。
- 导入外部规则集时，解析器把 `PROCESS-NAME/PROCESS-PATH/*-REGEX/*-WILDCARD` 统一转回语义化 IR；Surge 的 `PROCESS-NAME` 若值包含 `/` 或 `\` 视为 path，包含 `*` `?` 视为 wildcard。

### 3.3 规则集格式

| 来源格式 | 解析 | mihomo 输出 | Surge 输出 |
| --- | --- | --- | --- |
| classical 文本（Surge/Clash 通用） | ✅ | `behavior: classical, format: text`（或 yaml） | RULE-SET |
| mihomo YAML `payload:` | ✅ | 按 behavior 原样 | 转 RULE-SET / DOMAIN-SET |
| Surge DOMAIN-SET | ✅ | `behavior: domain`（`.example.com` → `+.example.com`） | DOMAIN-SET |
| 纯 CIDR 文本 | ✅ | `behavior: ipcidr` | RULE-SET（逐行加 `IP-CIDR,`） |
| mrs | ❌ 透传 | 原 URL，`format: mrs` | 不可用 ⇒ 报告 |
| sing-box json | P2 | — | — |
| srs | ❌ 透传 | 不可用 | 不可用 |

## 4. 基础设置映射（节选）

| IR | mihomo | Surge |
| --- | --- | --- |
| ipv6 | `ipv6` | `ipv6` |
| log level | `log-level` | `loglevel` |
| DNS 上游 | `dns.nameserver` | `dns-server` / `encrypted-dns-server` |
| 按域名指定 DNS | `dns.nameserver-policy` | `[Host]` 中 `domain = server:...` ⚠ |
| fake-ip | `dns.enhanced-mode: fake-ip` + `fake-ip-range` + `fake-ip-filter` | Surge 默认 fake-ip 行为；`always-real-ip` 对应 fake-ip-filter |
| 绕过 | — | `skip-proxy` / `tun-excluded-routes` |
| 测试 URL | 组级 `url` | `internet-test-url` / `proxy-test-url` |

基础设置没有完美的一一映射，因此 **BaseSettings 按客户端分别编辑**（每个预设含 mihomo 段与 Surge 段），IR 只抽象最常用的十几项用于"快速设置"表单。

## 5. 客户端识别（CR-04）

| UA 特征（示例） | 识别为 |
| --- | --- |
| `mihomo` / `clash.meta` / `Clash-Verge` / `FlClash` / `ClashMetaForAndroid` | mihomo；`ClashMetaForAndroid`、Android 版 FlClash ⇒ platform=android |
| `Surge iOS` / `Surge Mac` | surge；platform 由 UA 区分 |
| 其他 | 默认 mihomo，记录 UA 以便后续补充 |

URL 参数 `?target=&platform=` 优先于 UA。
