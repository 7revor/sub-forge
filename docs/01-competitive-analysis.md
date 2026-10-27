# 01 · 竞品调研：Sub-Store 与 妙妙屋

> 调研基于两个仓库 2026-10 的 `main` 分支源码，以及 mihomo 官方文档（MetaCubeX/Meta-Docs）。

## 1. Sub-Store（sub-store-org/Sub-Store）

**定位**：高级订阅管理器，Node.js 后端 + 独立前端，可运行在 Surge/Loon/QX 脚本环境或 Node 环境。许可证 **AGPL-3.0**。

### 1.1 核心模型

| 概念 | 说明 |
| --- | --- |
| 单条订阅 (Subscription) | 来源可以是远程 URL（可多条）或本地内容；有自己的处理链 `process[]` |
| 组合订阅 (Collection) | 引用多个单条订阅（`subscriptions[]`），先跑各自的处理链，再跑组合自身的处理链 |
| 文件 (File) | 任意文本/配置文件，可做脚本覆写（如往 mihomo 配置里插入某个订阅的节点：`AddProxiesFromSubscriptionOperator`） |
| 产物 (Artifact) | 订阅/组合/文件按目标平台输出后同步到 Gist 等 |

### 1.2 处理器（`backend/src/core/proxy-utils/processors/index.js`）

- 过滤：`RegexFilter`、`RegionFilter`、`TypeFilter`、`UselessFilter`、`ConditionalFilter`、`ScriptFilter`
- 操作：`RegexRenameOperator`、`RegexDeleteOperator`、`FlagOperator`、`SortOperator`、`RegexSortOperator`、`HandleDuplicateOperator`、`QuickSettingOperator`（udp/tfo/skip-cert 等）、`ResolveDomainOperator`、`ScriptOperator`
- 特点：**每次拉取都从原始内容重新跑一遍处理链**，天然是纯函数，结果确定。

### 1.3 输出

producers 覆盖 clash / clashmeta(mihomo) / surge / surgemac / loon / qx / stash / shadowrocket / sing-box / egern / uri / v2ray。
规则侧（`core/rule-utils`）支持把规则集转为 Surge RULE-SET、Loon、QX、Clash rule-provider 等格式。

### 1.4 我们认为的不足

1. **只管节点，不管"整份配置"**：分流、proxy-group 需要用户自备配置文件 + 脚本覆写，没有可视化编辑。
2. **代理链与 provider 冲突**：mihomo 中 `dialer-proxy` 只能指向本地 `proxies` 或 `proxy-groups` 的名字，无法直接指向 `proxy-providers` 里的节点。Sub-Store 产物要么打平到 `proxies`（丢失按订阅源分面板/分别更新的能力），要么无法表达链。
3. 规则没有"规则包"与"出口绑定"的概念。

## 2. 妙妙屋（Jimleerx/miaomiaowu，fork 自 iluobei/miaomiaowu）

**定位**：个人 Clash 订阅管理系统，Go 后端 + React(shadcn) 前端 + SQLite，含探针流量统计、多用户。仓库中未见 LICENSE 文件（不可直接复用代码）。

### 2.1 核心模型

| 概念 | 说明 |
| --- | --- |
| 节点 (nodes 表) | **节点作为数据库记录持久化**：`node_name`、`clash_config`、`chain_proxy_node_id`、`relay_group_name`、`tags` 等 |
| 外部订阅同步 | `external_sync.go`：拉取远端 → 按凭据键 `nodeCredentialKey` 与库内节点比对 → 新增/更新 |
| 模板 v3 | `rule_templates/*.yaml`：完整 mihomo 配置骨架，使用 `__PROXY_PROVIDERS__`、`__PROXY_NODES__` 占位，自定义字段 `dialer-proxy-group` |
| 链式代理 | 节点级 `chain_proxy_node_id` → 输出时注入 `dialer-proxy`；"落地节点组"内的节点自动注入 `dialer-proxy: 🌠 中转节点` |
| 生成订阅 | 可视化拖拽 proxy-group；规则模板 + 自定义规则 |

### 2.2 我们认为的不足

1. **节点是"有状态"的**：改名等操作直接改数据库中的节点记录。上游订阅更新后，节点按凭据匹配再合并，改名结果与上游名称混杂，出现重复/错乱（这是用户反馈的核心痛点）。
2. **模板与订阅是"复制"关系**：模板生成的是一份 YAML 文件（`subscribes/` 目录），模板后续更新不会传递到已生成的订阅。
3. 代理链实现依赖"把节点放进本地 proxies"，多订阅源仍被打平。
4. 规则只有单层列表，无规则包；无按客户端改写规则的能力。
5. 模板混合了 DNS、节点占位、group、rule，职责不清。

## 3. 关键技术事实（决定方案的约束）

来自 mihomo 官方文档（`docs/config/proxies/dialer-proxy.md`、`proxy-groups/index.md`、`proxy-providers/index.md`）：

1. `dialer-proxy` 的值可以是**策略组或出站代理的 name**，不能是 provider 内节点的名字。
2. 但 **provider 内节点可以通过 `override.dialer-proxy` 引用主配置里的策略组**（官方示例：`override: { dialer-proxy: select1 }`）。即：**"provider 节点 → 本地组"方向是通的，"本地 → provider 节点"方向不通**。
3. proxy-group 支持 `use: [provider]` + `filter` / `exclude-filter` / `exclude-type` + `hidden`。因此可以用一个隐藏的、`filter` 精确匹配单个节点名的 select 组来"包装" provider 里的某个节点，使其能被 `dialer-proxy` 或 rule 引用，**而不必把节点打平到 `proxies`**。
4. `relay` 类型组已废弃，链式代理统一用 `dialer-proxy`。
5. rule 的目标同样只能是本地 proxy / proxy-group / 内置策略，所以"规则直连 provider 内某个节点"与代理链是同一个问题，可用同一套"包装组"机制解决。

以上 2、3、5 是本项目代理链与规则引用方案的基础，详见 [03](03-domain-model-and-pipeline.md#4-依赖解析代理链与规则引用-provider-节点)。

## 4. 结论：取舍

| 维度 | 继承 | 改进 |
| --- | --- | --- |
| 节点加工 | Sub-Store 的纯函数处理链 | 处理链在"源"和"组合"两层都可用；节点不入库，只缓存原始快照 |
| 配置生成 | 妙妙屋的可视化 group/rule 编辑 | 模板只含分流；订阅 = 模板 ⊕ 订阅覆盖层，渲染时实时合并 |
| 代理链 | 妙妙屋的"落地组自动挂中转" | 支持引用 provider 节点、按需包装，不打平 |
| 规则 | 两者的规则集转换 | 两层规则包 + 按客户端改写 |
