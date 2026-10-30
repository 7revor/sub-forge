# 订阅名称与模板设置合并验收（2026-10-30）

新建和详情共用一张卡片，桌面左右分栏，窄屏上下排列。移除新建独立名称卡片与详情输出设置中的重复名称输入；模板转换仍只改草稿，统一保存。名称用于订阅及客户端显示，详情保存时去除首尾空白并拦截空值。

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| 新建空名称与占位 | passed | `new-empty.png`；placeholder 为「例如：日常使用」，创建禁用 |
| 输入名称后应用模板 | passed | `new-bound.png`；同卡片显示名称与精简模板，应用模板后保留名称 |
| 创建并进入详情 | passed | 创建隔离测试订阅成功，名称、模板、三个策略组回显 |
| 详情清空名称 | passed | 保存禁用、aria-invalid 为 true；「客户端中的显示名」重复输入数量为 0 |
| 重命名保存与刷新 | passed | `detail-saved.png`；首尾空白移除，刷新仍显示「合并卡片保存验收」和精简模板 |
| 390px 窄屏 | passed | `mobile.png`；名称和模板在同一张卡片上下排列，页面宽与滚动宽均为 390 |
| 前端类型检查 | passed | `pnpm --filter @sub-forge/web typecheck`，退出码 0 |
| 草稿和关联回归 | passed | `vitest run src/pages/profile/routing.test.ts src/pages/profile/associationModel.test.ts`，2 文件、9 项通过 |
| 外部画布同步 | not_run | 同日访问要求登录，本轮未重试或编辑；待同步布局记录在 docs/13 |

浏览器使用 Codex 内置浏览器；内存隔离 fixture、虚构账号及数据，没有修改真实订阅。后端接口、存储和示例种子不变，无需重复后端完整测试。完成后关闭临时页、重置视口，停止本轮 API / Vite。
