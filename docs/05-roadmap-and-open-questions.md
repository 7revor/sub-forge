# 05 · 里程碑、技术选型与待决问题

## 1. 里程碑

| 阶段 | 范围 | 可交付 |
| --- | --- | --- |
| **M0 内核** | 节点解析器、处理链（P0 处理器）、Collection、规则 IR 与解析、mihomo Lowering、依赖解析（wrap/copy/inline）、模板⊕覆盖层合并、模板校验器 | 纯函数库 + 快照测试（输入快照 → 输出 YAML）+ 代理链集成测试（[06 §6](06-proxy-chain-research.md#6-m0-需补的集成测试)） |
| **M1 MVP** | 数据存储、多用户、Source/Collection/本地节点 UI、处理链编辑与逐步预览、模板编辑器、Profile 向导、订阅接口、mihomo 输出、`mihomo -t` 校验 | 可给第一批用户使用（仅 mihomo） |
| **M2 Surge** | Surge Lowering、policy-path 拆子组、进程规则降级、Surge 基础设置 | mihomo + Surge |
| **M3 增强** | 规则包 UI 完善、规则改写脚本、模板版本 diff 与影响分析、管理员共享、访问日志、流量信息聚合 | 正式版 |
| 之后 | Loon / Stash / sing-box 输出、探针等 | — |

建议 M0 先行：所有棘手问题（依赖解析、模板合并、客户端降级）都在内核里，可以完全用单元测试/快照测试驱动，不依赖 UI。

### 1.1 进度

更新于 2026-10-28。

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 前端设计稿 | ✅ | 21 张画板覆盖 PRD §7 信息架构（缺普通用户的模板浏览页）；位于 Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)，未纳入仓库 |
| **M0 内核** | 基本完成 | 见下表 |
| M1 MVP | 基本完成 | 服务端（见下表）与前端（`packages/web`，按设计稿实现全部页面，主要编辑器为表单 + YAML 双视图，见 [09](09-frontend-forms-plan.md)；缺普通用户的模板可见性设置）；生产镜像同源托管 |
| M1 稳定化 | 本分支验收完成 | 用户禁用、快照地址加密、代理链防绕行与环检测、订阅资源版本、历史依赖保护、规则参数、YAML 编辑保护与稳定 ID；350 项通过、2 项跳过，见 [10](10-m1-stabilization.md)。待用户决定合并与部署 |
| M2 Surge | 未开始 | 内核中规则降级（含进程规则）已实现 Surge 分支 |
| M3 增强 | 未开始 | — |

M0 明细（代码在 `packages/core`，Docker 完整环境 92 个测试通过）：

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| 节点解析器 | ✅ | URI / Base64 / Clash YAML / Surge `[Proxy]`；ss、vmess、vless(reality)、trojan、hysteria2、tuic、anytls、socks5、http。**未复用 Sub-Store**，自行实现 |
| 处理链（P0 处理器） | ✅ | 逐步 trace、末尾去重兜底；脚本处理器（SRC-08）未做，需沙箱 |
| Collection | ✅ | 前后缀、环检测；成员拉取失败策略（COL-05，P1）未做 |
| 规则 IR 与解析 | ✅ | classical / DOMAIN-SET / 纯 CIDR / YAML payload，mrs 透传；逻辑规则（RS-04，P1）未做 |
| 按客户端降级 | ✅ | mihomo 与 Surge 规则写法、进程规则降级、行级覆盖 |
| 模板 ⊕ 覆盖层、模板校验器 | ✅ | 发布前影响分析（TPL-07 ②）需服务层逐个试渲染，未做 |
| mihomo Lowering 与依赖解析 | ✅ | wrap / copy / inline、四类代理链、引用校验、跨 provider 环检测 |
| 快照测试 | ✅ | PRD 场景 1–6 均有用例 |
| 集成测试 | ✅ | Docker 验证镜像（`--network none`）内运行：13 项配置校验（含 provider 展开与 GEOIP）、6 项代理链运行时验证、4 项规则参数运行时验证 |

与文档的差异：PRD 场景 3 中落地整源走同一前置时，按 03 §4.2 输出 `override.dialer-proxy`，而非逐节点注入；只给部分落地挂前置时才注入 Profile 专属 provider。

M1 服务端（代码在 `packages/server`，Docker 完整环境 103 个测试通过）：

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| 存储 | ✅ | better-sqlite3 存 JSON 文档（未用 Drizzle）；模板按版本保存；种子文件导入；旧库自动升级 |
| 敏感数据加密（SYS-04） | ✅ | 文档、快照 URL / 正文 / 错误、渲染结果与结构版本、订阅 token 用 AES-256-GCM 加密；URL / token / 会话以 HMAC 为索引；密码 scrypt |
| 上游拉取与快照 | ✅ | UA / 超时 / 重定向 / 大小上限；stale-while-revalidate；同 URL 并发合并；保留最近 5 份 |
| SSRF 防护（SYS-02） | ✅ | 建连时 DNS 解析校验 + 字面 IP 预检，支持白名单 |
| 渲染服务 | ✅ | 缓存、上一份成功结果整套兜底（OUT-05 / TPL-12）、保留 32 个结构版本并配套下发资源、可选 `mihomo -t` 校验、流量信息汇总（SRC-05） |
| 订阅接口（OUT-01 – 06） | 部分 | mihomo 全部完成；Surge 返回 501（M2） |
| 端到端验证 | ✅ | Docker 内：服务经 undici 拉取上游、mihomo 客户端用订阅地址加载配置并从服务下载 provider，流量经代理链（落地在 provider / 内联） |
| 客户端识别（CR-04） | ✅ | URL 参数优先，其次 UA；访问日志（PRF-07） |
| 多用户与登录（SYS-01） | ✅ | 会话 cookie、登录失败锁定、CSRF 防护、管理员管理用户 |
| 管理接口 | ✅ | 文档增删改查（按用户隔离、保存前校验、被引用不可删）；订阅链接管理；Profile 预览；处理链逐步预览；规则集预览；立即拉取与快照历史；访问日志 |
| 模板发布（TPL-05 / 07 / 11） | ✅ | 版本与变更说明、即时校验、发布前影响分析（会渲染失败的需强制发布）；草稿只在前端 |
| 生产镜像（SYS-08） | ✅ | 非 root、数据卷、健康检查、首次启动创建管理员；在断网容器中冒烟测试通过 |
| 管理员共享（SYS-06）、模板可见性（TPL-08） | 未开始 | P1 |
| 前端 | ✅ | React + Vite；处理链编辑器、Profile 七步向导与七个标签、模板表单编辑（含 YAML 视图、版本对比）与发布、本地节点协议表单、基础设置表单与逐项覆盖、节点选择器与 filter 命中预览、客户端覆盖（CR-02）、管理员页面；窄屏折叠导航；已在生产镜像中走通「建订阅源 → 处理链 → 建 Profile → 生成链接 → 拉订阅」，表单化后走通「表单 / YAML 建模板 → 发布 → 向导建 Profile → 草稿预览」 |
| 前端未完成 | — | 订阅源经由代理拉取（SRC-02）、规则仓库（RS-07，单独立项）、规则包合并统计（RB-04）、Surge 基础设置表单（M2） |

Docker 验证中发现并修复的问题：

- mihomo 默认让 provider 下载也经过分流规则；当 MATCH 指向的组依赖代理链、链的前置又在待下载的 provider 里时互相等待，provider 永远加载不上。现在本服务的 provider 与规则集都输出 `proxy: DIRECT`。
- undici 把建连失败统一报成 "fetch failed"，SSRF 拦截原因丢失；现在报告真实原因。

仍无法在 Docker 中验证：Surge（只有 macOS / iOS 客户端）；图形界面客户端（Clash Verge、FlClash）对响应头的读取（07 C4）。

## 2. 技术选型建议

| 层 | 建议 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript（前后端统一） | 节点协议解析、YAML 处理、JS 脚本处理器都在 JS 生态最成熟；IR 类型可前后端共享，UI 预览可直接在浏览器跑同一份渲染内核 |
| 后端 | Node.js 22 + Hono/Fastify | 轻量 |
| 存储 | SQLite（Drizzle ORM） | 单容器部署，数据量小 |
| 前端 | React + shadcn/ui + dnd-kit（拖拽） | 与妙妙屋相近，组件成熟 |
| 脚本沙箱 | QuickJS（quickjs-emscripten）或 isolated-vm | 用户脚本在服务端执行，必须隔离 |
| 校验 | 容器内置 mihomo 二进制，执行 `mihomo -t -f` | 保证 G3 |
| 部署 | 单 Docker 镜像 | — |

**许可证（已定）**：本项目采用 **AGPL-3.0**，可直接复用 Sub-Store 的协议解析器 / producer 代码（需保留原版权声明并注明来源）。妙妙屋仓库未见 LICENSE，**不复用其代码**，只参考思路。

## 3. 待决问题

### 3.1 已决定

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | 许可证 / 复用 Sub-Store | **AGPL-3.0，复用 Sub-Store 解析器** |
| Q2 | 依赖节点显式还是自动 | **自动解析，可见可改**（PRD 4.6） |
| Q3 | 模板组未填充时如何输出 | **输出空组**，行为由模板组声明，**默认拒绝**，可选直连（PRD TPL-10；2026-10-28 修订，原为一律 `COMPATIBLE`） |
| Q4 | 模板组能否预设 filter | **不预设**，filter 只在 Profile 中设置 |
| Q7 | 模板更新是否需要用户确认 | **不需要**，客户端下次刷新主订阅时自动采用；旧主配置继续读取兼容的版本化资源（见 [10](10-m1-stabilization.md)）；发布前做校验与影响分析，模板不可用时提示（PRD TPL-07/11/12） |
| Q5 | 模板组之间的引用是否属于模板 | **属于** |
| Q6 | Profile 能否删除 / 改名模板中的组 | **不能**删除、改名或隐藏，只能填充成员、调整参数 |
| Q8 | 普通用户能否编写脚本处理器 | **先仅限管理员**，可按用户授权 |
| Q9 | Surge 外部节点集输出方式 | **只用 `policy-path`**；代理链用组级 `underlying-proxy`，低版本 Surge 不支持并提示 |
| Q10 | 项目名 | **sub-forge** |
| R1–R4 | 规则仓库 | 默认直连；mihomo 默认 mrs；托管时保留来源与许可证声明；自定义仓库仅限管理员 |
| D1–D3 | 依赖采集结果的设计 | Surge 支持前置组；Surge 包装组用 fallback + REJECT 暂定写法；最低 mihomo v1.19.27，不降级 |

### 3.2 暂定说明

3.1 中 Q5 之后的各项于 2026-10-28 暂定，详细依据见 [07 §8](07-verification-checklist.md#8-决策记录)。剩余采集项（[07 §7.1](07-verification-checklist.md#71-剩余采集项)）的结果与之冲突时再修订。
