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
| Q7 | 模板更新是否需要用户确认 | **不需要**，自动生效；发布前做校验与影响分析，模板不可用时提示（PRD TPL-07/11/12） |
| Q5 | 模板组之间的引用是否属于模板 | **属于** |
| Q6 | Profile 能否删除 / 改名模板中的组 | **不能**删除、改名或隐藏，只能填充成员、调整参数 |
| Q8 | 普通用户能否编写脚本处理器 | **先仅限管理员**，可按用户授权 |
| Q9 | Surge 外部节点集输出方式 | **只用 `policy-path`**；代理链用组级 `underlying-proxy`，低版本 Surge 不支持并提示 |
| Q10 | 项目名 | **sub-forge** |
| R1–R4 | 规则仓库 | 默认直连；mihomo 默认 mrs；托管时保留来源与许可证声明；自定义仓库仅限管理员 |
| D1–D3 | 依赖采集结果的设计 | Surge 支持前置组；Surge 包装组用 fallback + REJECT 暂定写法；最低 mihomo v1.19.27，不降级 |

### 3.2 暂定说明

3.1 中 Q5 之后的各项于 2026-10-28 暂定，详细依据见 [07 §8](07-verification-checklist.md#8-决策记录)。剩余采集项（[07 §7.1](07-verification-checklist.md#71-剩余采集项)）的结果与之冲突时再修订。
