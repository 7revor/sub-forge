# 06 · 代理链专项调研：前置/落地在本地或 provider 中的通解

> 依据：mihomo 源码（MetaCubeX/mihomo `Alpha` 分支，2026-10-26）与官方文档（MetaCubeX/Meta-Docs）。
> 本篇结论均来自**阅读源码**；因环境限制尚未用 mihomo 二进制实际跑过，M0 阶段需补一组集成测试（见 §6）。

术语：**落地** = 最终出口节点（带 `dialer-proxy` 字段的那个）；**前置** = `dialer-proxy` 指向的节点/组（落地经由它建立连接）。

## 1. mihomo 中 dialer-proxy 的实际工作方式

### 1.1 运行时按名称查找

`adapter/outbound/base.go`：

```go
DialerProxy string `proxy:"dialer-proxy,omitempty"` // don't apply this option into groups, but can set a group name in a proxy
...
if b.DialerProxy != "" {
    cDialer = proxydialer.NewByName(b.DialerProxy, b.NewTunnel())
}
```

`component/proxydialer/byname.go`：每次拨号时执行 `tunnel.Proxies()[proxyName]`，找不到则本次连接报错 `proxyName[%s] not found`。

`tunnel.Proxies()` 是**顶层名称表**，由 `config/config.go` 的 `parseProxies` 构建，内容只有：

- 内置：`DIRECT`、`REJECT`、`REJECT-DROP`、`COMPATIBLE`、`PASS`、`PASS-RULE`
- 本地 `proxies:` 中的节点
- 所有 `proxy-groups`（含自动生成的 `GLOBAL`）

**provider 内的节点不在这张表里**，即便前置与落地在同一个 provider 中也一样（07 M3 实测：同源直接写名称，运行时报 `proxyName[...] not found`）。

### 1.2 加载时校验只覆盖本地节点

`config/config.go` 末尾调用 `validateDialerProxies(proxies)`（`config/utils.go`）：遍历顶层表，若某节点的 `dialer-proxy` 不在顶层表中则**配置加载失败**：`proxy [x] dialer-proxy [y] not found`，并做环检测。

provider 内的节点不参与这一步。它们的 `dialer-proxy` 在加载时**不校验**，写错了只会在运行时每次连接失败。

### 1.3 provider 节点同样可以写 dialer-proxy

`adapter/provider/provider.go` 的 `NewProxiesParser`：对 provider 内容中的每个节点 mapping，依次应用 provider 级 `dialer-proxy`、`override`，再调用与本地节点相同的 `adapter.ParseProxy(...)`，并传入同一个 tunnel。因此：

- provider 内容里节点自带的 `dialer-proxy` 字段会生效；
- `proxy-providers.<name>.override.dialer-proxy`（文档已记载）会给整个 provider 的节点设置前置；
- 源码中 provider 还有顶层 `dialer-proxy` 字段（`adapter/provider/parser.go`），作用与 override 相同，但文档未记载，**不使用**。

这些名称最终都在**顶层表**里查找。

### 1.4 组可以把 provider 中的单个节点"升格"为顶层名称

`adapter/outboundgroup/groupbase.go` 的 `GetProxies`：组的 `filter` 会作用于 `use` 引入的 provider 节点。所以下面这个组只含一个节点，且这个组本身在顶层表里：

```yaml
- name: __ref_T_3f2a
  type: select
  use: [T]
  filter: ^🇭🇰 IPLC-01$
  hidden: true
  empty-fallback: REJECT
```

- `dialer-proxy` 可以写组名（源码注释："can set a group name in a proxy"；官方文档：值可以为策略组或出站代理）。
- `empty-fallback` 的默认值是 `COMPATIBLE`（即直连）。它只接受非组的顶层名称，`REJECT` 合法（见 `outboundgroup/parser.go`）。

### 1.5 组本身不能设置 dialer-proxy

`dialer-proxy` 只对节点生效（"don't apply this option into groups"）。官方 dialer-proxy 文档也说明 `relay` 组已废弃。所以"让某个组整体走前置"只能落实为给组里的每个节点写 `dialer-proxy`。

## 2. 通解

两条规则：

> **规则一（落地侧）**：`dialer-proxy` 永远写在**落地节点自身**上，不论这个节点在本地 `proxies` 还是在 provider 内容里。
>
> **规则二（前置侧）**：`dialer-proxy` 的值永远是**顶层名称**。前置是本地节点或任意策略组时，直接用其名称；前置是 provider 中的节点时，先用隐藏包装组（§1.4）把它升格为顶层名称。

两条规则互不影响，可以自由组合。四种场景（加上两端都在 provider 的情况）都按这两条处理：

| # | 前置在 | 落地在 | 落地侧写法 | 前置侧取值 | mihomo 加载时校验 |
| --- | --- | --- | --- | --- | --- |
| 1 | provider | 本地 | `proxies` 中写 `dialer-proxy` | 包装组名 | ✅ 校验（组在顶层表） |
| 2 | 本地 | provider | provider 内容中写 `dialer-proxy`（或整源用 `override.dialer-proxy`） | 本地节点名 | ❌ 不校验，需服务端校验 |
| 3 | 本地 | provider | 同 2 | 同 2 | ❌ 同 2 |
| 4 | 本地 | 本地 | `proxies` 中写 `dialer-proxy` | 本地节点名 | ✅ |
| 5 | provider | provider（同源或异源） | provider 内容中写 `dialer-proxy` | 包装组名（同源也必须用包装组） | ❌ 需服务端校验 |
| 6 | 策略组（如"🌠 中转"） | 任意 | 同上 | 组名，用户可在面板中切换前置 | 落地在本地时 ✅ |

你的问题 2、3 的答案是：**可以**（07 M2 实测）。provider 中的节点可以引用本地节点或本地组，这是 mihomo 官方文档推荐的迁移方案（`override.dialer-proxy: select1`），源码层面就是 §1.3 所述的运行时按名称查找。

场景 6 最实用：前置写成一个策略组，组里放若干中转节点（本地或 provider 的都行），用户在面板里切换中转，所有落地跟着切换，不需要重新生成配置。

### 2.1 落地侧的三种写法

| 落地集合 | 写法 | 说明 |
| --- | --- | --- |
| 本地节点 | 直接写入 `proxies[i].dialer-proxy` | — |
| provider 整源同一前置 | 在本服务的订阅专属 provider 中给每个节点写入 `dialer-proxy: X` | 与局部链使用同一服务端处理路径；不再输出 provider 级 override |
| provider 中部分节点 | 本服务下发 **Profile 专属** provider 内容，只在命中的节点上加 `dialer-proxy: X` | `X` 是本 Profile 的组名，所以 provider 内容必须按 Profile 生成 |

## 3. 必须处理的风险

| 风险 | 原因 | 对策 |
| --- | --- | --- |
| **静默直连（泄漏）** | 包装组按 `filter` 筛不出节点时（provider 尚未下载完成、上游删除或改名了该节点），组会回退到 `empty-fallback`，默认是 `COMPATIBLE`，即直连。落地会绕过前置直连出去，用户毫无察觉 | 包装组一律输出 `empty-fallback: REJECT`，失败时拒绝连接（REF-10）。07 M5 已实测：不写时泄漏可复现，写了则连接被拒绝；该字段要求 mihomo v1.19.27+ |
| **写错的名称不报错** | provider 内节点的 `dialer-proxy` 在加载时不校验（§1.2），`mihomo -t` 也查不出来 | 服务端渲染时自行校验所有 `dialer-proxy` 目标都在顶层表中（REF-08 升为 P0） |
| **跨 provider 的环** | mihomo 的环检测只覆盖本地节点 | 服务端在"节点→前置"图上做环检测，包装组和 provider 节点都计入（REF-09） |
| **主配置与 provider 不同步** | 客户端分别刷新主配置和 provider。主配置里的组改了名，provider 里还是旧名，在 provider 下次刷新前连接会失败 | ① 包装组名用稳定哈希（`__ref_<源>_<节点 key 哈希>`），与显示名无关；② provider URL 带内容版本 `?v=<链配置哈希>`。http provider 的缓存路径由 URL 哈希决定（`C.Path.GetPathByHash("proxies", url)`），URL 一变，客户端重载主配置时就会重新下载 provider；③ **provider 不写 `path`**，否则缓存在 `interval` 内不会重新下载（07 M8 实测） |
| **名称精确匹配** | `filter` 是正则 | 名称做正则转义并加 `^…$`；SRC-11 保证同源内名称唯一 |
| **客户端侧改名** | provider 的 `override.additional-prefix` / `proxy-name` 会在 `filter` 之前改掉节点名 | 改名一律在服务端处理链中完成，生成 provider 时不使用客户端侧的改名 override |
| **组不能当落地** | §1.5 | UI 中"把某组设为落地"会展开为给组内节点写 `dialer-proxy`。组用 `use` 引入 provider 时按 §2.1 处理 |

## 4. 规则出口 / 组成员引用 provider 节点

和代理链的前置侧是同一个问题：rule 的目标、组的 `proxies` 成员都只能写顶层名称。做法相同，用包装组（同一个节点在一个 Profile 中只生成一个包装组，代理链、规则、组成员共用）。

## 5. Surge

依据 Surge 手册与 `surge-cli --check`（07 S1–S5）。决策见 07 §8 的 Q9、D1、D2。

### 5.1 与 mihomo 的对应关系

| mihomo | Surge |
| --- | --- |
| provider | 组参数 `policy-path`（外部节点只存在于引入它的组里） |
| 节点 `dialer-proxy` | 节点 `underlying-proxy`，只能写在 `[Proxy]` 中的节点上 |
| `override.dialer-proxy`（整源） | **组级 `underlying-proxy`**（iOS 5.22.0+ / Mac 6.9.0+）：作用于该组的全部成员，包括 `policy-path` 引入的外部节点 |
| 包装组 `use` + `filter` | `policy-path` + `policy-regex-filter=^name$` 的隐藏组 |
| `empty-fallback: REJECT` | 无。组没有可用成员时回退 DIRECT（日志 `SUBSTITUTE`） |

已确认：

- 规则和节点级 `underlying-proxy` **不能**直接写外部节点名（`unknown policy name` / `unknown underlying proxy`），前置侧必须用包装组，即规则二同样适用；
- `underlying-proxy` 的值**可以是策略组**（"so the entry node can be selected dynamically"），场景 6 成立（D1）。

### 5.2 通解

> **落地侧**：落地是本地节点 → 节点上写 `underlying-proxy`；落地在外部节点集 → 用带组级 `underlying-proxy` 的隐藏组包住这些节点。**不需要**像 mihomo 那样按 Profile 生成注入了前置的专属外部内容。
>
> **前置侧**：值永远是 `[Proxy]` 节点名或组名；前置在外部节点集时，用包装组。

```ini
[Proxy Group]
; 前置在外部节点集 T：包装组（D2 暂定写法，防静默直连 ⏳）
__ref_T_3f2a_in = select, policy-path=https://svc/p/<token>/T, policy-regex-filter=^🇭🇰 IPLC-01$, hidden=true
__ref_T_3f2a    = fallback, __ref_T_3f2a_in, REJECT, hidden=true

; 落地在外部节点集 L，其中匹配 filter 的节点走前置
__chain_L_9b1c = select, policy-path=https://svc/p/<token>/L, policy-regex-filter=<落地 filter>, underlying-proxy=__ref_T_3f2a, hidden=true
```

用户组引用这些落地时，把 `__chain_L_9b1c` 作为嵌套成员，或用 `include-other-group="__chain_L_9b1c"` 展开（展开后是否保留 ` (via X)` 派生策略 ⏳）。

要点：

- 组级 `underlying-proxy` 不影响成员中的组和内置策略；成员自带的 `underlying-proxy` 会被组级值覆盖；
- 被链接的成员显示为 `Name (via X)`，有独立的测速与流量统计；
- 组级 `underlying-proxy` 指向自身会被拒绝；指向不存在的名称时离线校验不报错，所以服务端校验（REF-08）对 Surge 同样必要；
- Surge iOS 5.22.0 / Mac 6.9.0 以下没有组级 `underlying-proxy`。按 Q9，不内联回退：这些版本下外部节点集上的代理链不输出，并在渲染报告中提示。

### 5.3 仍需运行时验证（07 §7.1）

- `fallback, Inner, REJECT` 在 Inner 筛空时是否真的拒绝连接（Inner 回退 DIRECT 后可能仍被判为可用）；
- 组成员直接写外部节点名是否可行（离线校验不能判断）；
- 一个组写多个 `policy-path` 是否都生效；
- `include-other-group` 展开带组级 `underlying-proxy` 的组时，派生策略是否保留。

## 6. M0 需补的集成测试

运行环境：容器内的 mihomo 二进制。三个 socks5 入站分别扮演"前置"和"落地"，再加一个本地 HTTP 回显服务。

| 用例 | 断言 |
| --- | --- |
| 场景 1–6 各一份配置 | `mihomo -t` 通过；请求经过前置（前置入站日志里有连向落地地址的连接） |
| 包装组 filter 落空 | 连接被拒绝，而不是直连 |
| 同源 provider 内直接写前置名称 | 运行时失败（证明同源也需要包装组） |
| provider 写了 `path` 后改 `?v=` | 不重新下载（证明 Lowering 不能输出 `path`） |
| provider 节点 dialer-proxy 写错名称 | `-t` 通过（证明 mihomo 不校验），本服务的校验器报错 |
| 主配置改了组名、provider 未刷新 | 使用稳定包装组名 + 带版本的 URL 后不出现失败 |
