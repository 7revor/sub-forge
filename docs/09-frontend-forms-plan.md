# 09 · 前端表单化改造方案

- 日期：2026-10-29
- 范围：`packages/web`，以及为此需要的少量服务端 / 内核配合
- 依据：按 [02 PRD](02-PRD.md) 审查 M1 前端的结论（见 §1）

实施状态：主要表单化与七步向导已完成，§1 保留改造前的问题背景。后续稳定化已补齐 Profile 无效 YAML 的保存 / 离开保护和模板 YAML 的稳定 ID 往返，验收见 [10](10-m1-stabilization.md)；仍未完成项见 [05 §1.1](05-roadmap-and-open-questions.md#11-进度)。2026-10-29 起页面结构以设计稿为准重写（含处理链、对话框、列表页等补充画板），本文的编辑方式与组件仍然适用，逐页对照见 [11](11-design-coverage.md)。

## 1. 现状与问题

M1 前端的页面覆盖了 PRD §7 的信息架构，但几个核心编辑器直接让用户手写配置，和 PRD 的意图相反：LOC-01 要求「表单**或**粘贴」，BS-04 把「原样片段」定位为**逃生通道**，也就是说表单是主要的编辑方式，原始配置只是补充。

### 1.1 现在要手写配置的地方

| 位置 | 现状 | PRD 要求 |
| --- | --- | --- |
| 模板编辑器 `Templates.tsx` | `groups / rules / final` 整份写 JSON | 组骨架、规则、为空时的行为、填充提示分别编辑；拖拽排序（GRP-08）；校验出错的项在编辑器中标红（TPL-11） |
| 基础设置预设 `Presets.tsx` | mihomo 段写 JSON；没有 Surge 段 | BS-01 字段分组表单；BS-02 Surge `[General]` / `[Host]` |
| Profile 基础设置 `TabsBasic.tsx` | 覆盖项写 JSON 补丁 | 在预设值上逐项覆盖、还原（BS-03） |
| 本地节点 `Locals.tsx` | 协议是自由文本输入；名称、服务器、端口之外的字段写 JSON | 按协议的表单（LOC-01） |
| 处理链 · 快捷设置 | JSON | udp / tfo / skip-cert-verify 等开关（SRC-07） |
| 处理链 · 协议类型过滤 | 逗号分隔的文本 | 多选 |
| 单条规则（规则包、私有规则） | 只能手写 `TYPE,value` 整行 | 类型 + 值；GEOSITE / GEOIP / 语义化进程规则（RL-02、CR-01） |

### 1.2 交互与功能缺口（P0）

| 缺口 | 需求 |
| --- | --- |
| Profile 建好后不能更换模板，也不能锁定版本（新建页的提示承诺了这个入口，详情页里没有） | TPL-06 |
| 新建向导只有前 3 步，之后直接跳到详情页 | 4.9、PRF-01 |
| 组顺序、成员都不能拖拽排序 | GRP-08 |
| 设置 filter 时不显示命中了哪些节点 | GRP-03 |
| 测速参数缺 `timeout`、`lazy`、`max-failed-times`、`expected-status` | GRP-04 |
| 「全部节点」只能选 providers 一种范围；私有组不能设置为空时的行为 | GRP-02、TPL-10 |
| 单节点引用要手打节点名，不能从节点列表里选；不支持按正则匹配 | REF-01 |
| 私有规则只能挂在锚点前后，不能拖拽排序 | RL-01 |
| 客户端覆盖（替换 / 丢弃）没有界面 | CR-02 |
| 本地节点的前置只能选单个节点，不能选组（组列表传的是空数组）。2026-10-29 本地节点前置整体移除，代理链只在 Profile 中设置 | LOC-02、REF-12 |
| 模板版本之间看不到 diff | TPL-05 |
| 订阅源缺「经由某个代理拉取」 | SRC-02 |
| 规则仓库：前端没有页面，服务端也没有实现 | RS-07、[08](08-rule-repository-index.md) |

P1 缺口（GRP-05/06、RL-04、RB-04、BS-04、系统设置页、SYS-06）放进 §6 的最后一期。

## 2. 原则

1. **表单为主，原始配置为辅。** 每个编辑器默认显示表单；「原始配置」是同一份数据的另一种视图，用来批量粘贴、从已有配置迁移，或者编辑表单还没覆盖到的字段。
2. **两边编辑同一个对象。** 表单和原始视图都直接读写页面草稿，不各存一份。切换视图时，把当前草稿转换成另一种表示。
3. **不丢字段。** 表单没覆盖到的字段原样保留，在表单底部显示为「其他字段 N 个」，可以展开用键值方式编辑。这样内核或客户端新增参数时，前端不需要立刻跟进。
4. **原始视图用用户熟悉的格式。**

   | 编辑器 | 原始视图格式 | 理由 |
   | --- | --- | --- |
   | 本地节点 | mihomo `proxies` 条目的 YAML；另外保留「粘贴导入」（URI / Base64 / Surge 行） | 用户手里通常就是这些格式 |
   | 基础设置 | mihomo 配置顶层 YAML；Surge 段用 INI（M2） | 可以直接从现有配置复制 |
   | 模板 | mihomo `proxy-groups` + `rules` 的 YAML 片段，双向转换 | 同时满足 TPL-09（导入）；内部的 JSON 结构不给用户看 |
   | 规则 | 一行一条的 classical 文本 | 已有 `parseRuleLine` |

5. **缺项或解析错误也允许返回表单。** 原始视图就地报错并禁止保存，但「表单」始终可选。返回时保留能可靠解析的有效字段，忽略错误字段 / 条目并明确列出；未知扩展字段仍保留。再次进入原始视图显示清理后的内容；保存 / 发布独立执行必填项和业务校验。此规则统一用于节点、模板、基础设置与预设（2026-10-29 按用户要求修订）。
6. **校验结果落到具体字段上。** 服务端报告的 `where`（如 `group:<id>`、`rule:<id>`）映射到表单项，给出错的项标红，点报告条目可以跳到对应的项（TPL-11、TPL-07 ③）。

## 3. 公共组件

放在 `packages/web/src/components/`，各页面共用。

| 组件 | 职责 |
| --- | --- |
| `DualEditor` | 「表单 / 原始配置」切换。参数：`value`、`onChange`、`renderForm`、`toRaw`、`fromRaw`、`recoverForm(text) → { value, notes }`。严格解析控制原始视图的保存状态；返回表单时恢复有效字段并展示忽略项；同时提供格式化、复制与有效性通知 |
| `SchemaForm` | 由字段描述（`FieldSpec[]`：键路径、类型 bool / number / enum / string / string[] / kv、标签、提示、默认值、适用客户端）渲染分组表单。基础设置和各协议的节点表单都用它，字段集中定义在 `schemas/` 目录，表单代码里不写死字段 |
| `OverrideField` | `SchemaForm` 的覆盖模式：显示继承值（灰色）和覆盖值，每项可以「覆盖 / 还原」。用于 Profile 覆盖预设、Profile 覆盖模板组参数 |
| `SortableList` | 把 `PipelineEditor` 里的 dnd-kit 用法抽出来做成通用组件，支持拖拽手柄和键盘排序。组列表、组成员、规则列表、规则包子项、组合成员都用它 |
| `ExtraFields` | 「其他字段」的键值编辑（值按 YAML 标量解析），用于原则 3 和 GRP-06 的高级参数 |
| `RuleEditor` | 单条规则：类型下拉（按 `RuleIR` 分组：域名 / IP / GEO / 端口 / 网络 / 进程 / 逻辑）+ 值输入 + `no-resolve` 等选项；进程规则用名称 / 路径 × 精确 / 通配 / 正则三段选择（CR-01）。保留「粘贴整行」快捷方式 |
| `ClientOverrides` | 一条规则的客户端覆盖列表：「当 客户端 [平台] → 替换为 RuleEditor[] / 丢弃」（CR-02） |
| `NodePicker` | 从节点集的当前节点列表（处理链之后）中选择；支持「精确名称」和「正则」两种匹配，实时显示命中数和兜底策略（REF-01、REF-02） |
| `MatchPreview` | 给定节点集 + filter / exclude-filter / exclude-type，显示命中的节点（GRP-03，链规则的落地筛选也用它） |

## 4. 各页面改造

### 4.1 模板编辑器（TPL-01 – 05、TPL-10、TPL-11）

- **布局**：左侧是组列表（拖拽排序），右侧编辑选中的组；下方是规则列表（拖拽排序，末尾固定 MATCH）。规则和组的结构与 Profile 的「策略组」「规则」标签保持一致，减少两套交互。
- **组表单**：名称、类型、测速参数（GRP-04 全部字段，按类型显示）、负载均衡策略、为空时的行为（拒绝 / 直连）、填充提示、展示参数（P1）。成员只能选其他模板组或内置策略，界面上不提供节点类选项，从源头避免 `template.node-in-template`。
- **规则表单**：匹配项为 `RuleEditor` / 规则集 / 规则包；出口只能选模板组或内置策略。
- **新建组和规则时由前端生成稳定 ID**（TPL-04），改名不影响 ID。
- **即时校验**：沿用 `POST /templates/validate`，把报告的 `where` 映射到组 / 规则行并标红。
- **原始配置**：导出为 mihomo `proxy-groups` + `rules` YAML，也可以从这个格式导入（TPL-09 的前端部分）。导入时剥离节点和 filter，有损的地方列在导入报告里。
- **版本 diff**（TPL-05）：在版本记录中选两个版本，前端分别取 `GET /templates/:id/versions/:v`，按稳定 ID 对比，列出新增、删除、修改的组和规则。
- 发布与影响分析的流程不变，影响列表里的 Profile 可以点击跳转。

### 4.2 本地节点（LOC-01）

- 协议改为下拉，范围与内核解析器一致：ss、vmess、vless、trojan、hysteria2、tuic、anytls、socks5、http。
- 每个协议一份 `FieldSpec`，例如：
  - ss：cipher（枚举）、password、plugin / plugin-opts
  - vmess：uuid、alterId、cipher、network
  - vless：uuid、flow、network，以及 reality-opts（public-key、short-id）
  - trojan / anytls：password、sni
  - hysteria2：password、obfs / obfs-password、up / down、ports
  - tuic：uuid、password、congestion-controller、alpn
  - socks5 / http：username、password、tls

  另有公共分组：TLS（tls、servername / sni、skip-cert-verify、client-fingerprint、alpn）、传输（ws-opts / grpc-opts / h2-opts，按 network 显示）、通用（udp、tfo、ip-version）。
- 页面结构：`/locals` 分组列表 → `/locals/:id` 分组详情（节点表）→ `/locals/:id/nodes/:index` 节点编辑子页（`new` 为新增）。节点表单不再放在分组页右侧，子页保存即写回整个分组。
- 原始配置：当前节点的 mihomo YAML（在节点子页）。另外提供分组级的原始视图，即整个分组的 `proxies:` 列表，方便批量编辑（在分组详情的「更多」菜单）。
- 前置：~~本地节点上只能选单个节点作为前置~~。2026-10-29 起本地节点不再设置前置，代理链统一在 Profile 的「代理链」中设置（REF-03）；粘贴导入与 YAML 中出现前置字段时给出提示。

### 4.3 基础设置（BS-01 – 03）

- `schemas/mihomo-base.ts` 按 BS-01 分组：通用、外部控制、DNS、嗅探、TUN、GEO 数据。数组字段（nameserver、fake-ip-filter 等）用逐行编辑；`nameserver-policy` 用键值编辑。
- **预设页**：`SchemaForm` + 原始配置（YAML）。Surge 段在 M2 加，`PresetDoc` 预留 `surge` 字段（见 §5）。
- **Profile 基础设置标签**：引用预设时用 `OverrideField` 显示「预设值 / 我的覆盖」，生成的仍然是现有的 `base.patch` 结构（深度合并、数组整体替换），服务端不用改。完全自定义时就是普通 `SchemaForm`。
- BS-05（P1）：发现有进程规则而 `find-process-mode: off` 时，在这里给出提示。

### 4.4 处理链（SRC-06、SRC-07）

- 快捷设置：改成开关和输入框（udp、tfo、skip-cert-verify、client-fingerprint 等），不在列表里的字段放进 `ExtraFields`。
- 协议类型过滤：多选框。
- 正则类输入：一行一个输入框，旁边显示「命中 N 个」，数据来自现有的逐步预览；空行提示不会生效，内核也跳过空正则。
- SRC-02：订阅源的拉取参数增加「经由代理拉取」，需要服务端支持（§5）。

### 4.5 规则（RL-01 – 05、CR-01 – 02、RB-01 – 05）

- 规则包子项、Profile 私有规则、模板规则的「单条规则」都改用 `RuleEditor`。
- Profile 规则标签：
  - 私有规则可以拖拽到任意位置，保存时换算成现有的锚点结构（插在哪条模板规则之后），覆盖层的数据模型不用改；
  - 模板规则仍然不能移动，只能禁用、改出口（锁定图标标明）。
- 规则级选项 `no-resolve`、`src`（RL-04，P1）放在规则的展开面板里。
- 客户端覆盖：规则集详情页增加「行级覆盖」区，用 `ClientOverrides` 编辑 `RuleSet.overrides`；单条规则的覆盖需要先在 `RuleEntry` 上增加字段（§5）。
- 规则包：子项拖拽排序；P1 显示合并后的条目数和去重结果（RB-04）。

### 4.6 Profile · 策略组（GRP-01 – 08、PRF-09）

- 组列表拖拽排序。模板组的顺序由模板决定，不能拖动；私有组可以拖到任意位置。私有组的位置需要在覆盖层里记录（§5）。
- 成员拖拽排序。模板自带的成员固定在前面，追加的成员之间可以排序。
- 测速参数补齐；`MatchPreview` 实时显示 filter 的命中结果。
- 「全部节点」三种范围都可选（全部 / 本地节点 / provider）。
- 单节点成员改用 `NodePicker`。
- 私有组可以设置为空时的行为；模板组只读显示。
- 展示参数和高级参数（P1）用 `ExtraFields`，并标注各参数适用的客户端。

### 4.7 Profile · 向导与模板（4.9、PRF-01、TPL-06）

- 新建页改为 7 步向导：基础设置 → 节点集 → 模板 → 填充策略组 → 规则 → 代理链 → 预览。后 4 步直接复用详情页各标签的组件，向导只负责步骤导航和「下一步」时的校验。
- 每一步都可以跳过；在最后一步保存，之前不建文档。
- 详情页头部的模板徽章可点开「模板」对话框：更换模板（提示哪些覆盖项会变成孤儿）、跟随最新 / 锁定某个版本。

### 4.8 代理链

- 前置为单节点时改用 `NodePicker`；落地筛选用 `MatchPreview` 实时显示命中的落地节点。
- 链长度超过 3 跳、出现环时，在这里显示服务端报告的告警（REF-09）。

## 5. 需要的服务端 / 内核配合

| 改动 | 用途 | 规模 |
| --- | --- | --- |
| `GET /nodesets/:type/:id/nodes`：节点集经处理链之后的节点列表（名称、类型、server:port），带缓存 | `NodePicker`、`MatchPreview` | 小：复用 pipeline-preview 的逻辑，返回完整列表，不截断 |
| `PresetDoc` 增加 `surge?: { general?: …; host?: … }` | BS-02 预留 | 小（渲染部分在 M2） |
| `RuleEntry` 增加 `overrides?: ClientOverride[]` | 单条规则的客户端覆盖（CR-02） | 小：内核已有 `ClientOverride` 类型和应用逻辑 |
| 覆盖层支持私有组的位置（如 `extraGroups[].after?: groupId`） | 私有组拖拽排序 | 小：内核 `merge.ts` 按锚点插入 |
| 订阅源 `fetch.via`：经由某个代理拉取 | SRC-02 | 中：服务端要能用代理节点发请求，需要单独评估 |
| 规则仓库：索引、搜索、托管 | RS-07 | 大：按 [08](08-rule-repository-index.md) 单独立项 |

## 6. 分期

每一期都可以独立合并，单独提交。

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| **A** | 公共组件 `DualEditor`、`SchemaForm`、`SortableList`、`ExtraFields`、`RuleEditor`；**模板编辑器表单化**（含 YAML 导入导出、`where` 标红、版本 diff） | 无 |
| **B** | **本地节点**协议表单与 YAML 视图；**基础设置**表单（预设、Profile 覆盖）；处理链的快捷设置与类型过滤 | A（`SchemaForm`、`DualEditor`） |
| **C** | 节点列表接口 + `NodePicker` / `MatchPreview`；策略组的排序、测速参数、全部节点范围、私有组为空时的行为；规则列表的拖拽和客户端覆盖 | A；服务端小改动（§5 前四项） |
| **D** | Profile 7 步向导；概览里的更换模板 / 锁定版本 | C |
| **E** | 规则仓库（前后端） | 单独立项 |
| **F（P1）** | 组展示参数与高级参数、规则级选项、规则包统计、原样片段、系统设置页、管理员共享 | — |

建议顺序是 A → B → C → D；E 与 C、D 可以并行。

## 7. 验收

- **转换函数单元测试**：每个 `toRaw` / `fromRaw` 都做往返测试（表单 → 原始 → 表单不丢字段，包括表单没覆盖的字段），在 `packages/web` 下用 vitest。
- **Schema 覆盖检查**：用内核快照测试里的节点样例逐个填进协议表单，转换结果要与样例一致。
- **浏览器走查**：每期结束后在生产构建里走一遍，确认不写任何 JSON 也能完成对应流程：
  - A：新建模板 → 加组、规则 → 发布；
  - B：手动新建 vless reality 节点；建预设，并在 Profile 中覆盖 DNS；
  - C：规则出口选 provider 中的单个节点，预览中出现包装组；
  - D：用向导从零建出可以拉取的订阅。

## 8. 待确认

1. **原始视图的格式**：§2 建议用 mihomo YAML，而不是内部 JSON。代价是模板的 YAML 导入有损（导入时剥离节点和 filter），需要导入报告。
2. **Surge 基础设置**：本轮只预留数据结构，表单放到 M2 与 Surge 渲染一起做？
3. **规则仓库**（RS-07）是 P0，但工作量大，建议单独立项（E 期），不阻塞表单化。
4. **基础设置表单的字段范围**：先覆盖 BS-01 列出的全部字段，其余走「其他字段」。
