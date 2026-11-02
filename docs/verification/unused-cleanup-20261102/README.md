# 第一阶段无用代码清理验收

日期：2026-11-02。基线：`f558d57`。独立分支：`codex/cleanup-unused-20261102`，未合并。

## 清理范围

- 前端提交 `b5a7b23`：删除无入口引用的 `ProfileWizard`、`DualEditor`、`SchemaForm`、`override`、`orphans`、`ui/tabs`、`ui/separator` 及废弃实现专属测试；删除未使用的逐行追踪函数和 API 响应类型。
- 将仍有消费者的 `RawResult` 类型移到 `src/convert/result.ts`。当前 `mapRows`、`mapStats`、改名命中统计及 YAML 解析实现保留；空值与显式 `false` 的契约测试改由现用 `OptionalBoolean` 承接。
- 后端提交 `76ebc4e`：删除未读取的 `cacheSize`、`waitForFresh`、`loadNodeSets().hashes` 和恒定的内部 `Attempt.from`，从渲染来源类型中移除从未返回的 `cache`。
- 当前页面 JSX、样式源文件、有效接口、数据库结构、旧数据兼容分支、快照刷新、并发修订校验及 last-good 回退不变。依赖声明和锁文件不变。

## 静态与自动化验证

删除前核对前端入口依赖图、全仓引用和后端参数读写；类型引用迁出后，删除的 UI 模块没有生产入口消费者。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | core、server、web 全部通过 |
| `pnpm --filter @sub-forge/web test` | 46 文件通过；354 项通过、2 项跳过 |
| `pnpm --filter @sub-forge/core --filter @sub-forge/server test` | core：34 文件通过、4 文件跳过，704 项通过、40 项跳过；server：67 文件通过、2 文件跳过，616 项通过、5 项跳过 |
| `pnpm --filter @sub-forge/web build` | 类型检查与生产构建通过 |
| `git diff --check` | 通过 |

合计 1,674 项通过、47 项跳过。跳过来自原有条件：未配置真实 Mihomo / Surge 二进制及运行环境，或节点协议没有对应样例；本次没有新增跳过。未将真实内核验证或真实上游访问记为通过。

构建前后均为 2,417 个模块。排除末尾 sourcemap 文件名后，生产 JavaScript 字节完全一致，SHA-256：`b53bc716d3a86291c117bfb56db0125e12e134dc7017af85b1dd831de6969647`。CSS 从 91,020 字节降到 85,428 字节，减少 5,592 字节。构建仍有既有的单包超过 500 kB 提示。

## 内置浏览器验收

使用 Codex 内置浏览器，访问临时 `127.0.0.1:19042` 服务。数据库为 SQLite `:memory:`；账号、模板、节点、订阅源均为虚构数据，上游由受控快照拉取器返回固定两条节点。基于仓库已有 `manual-subscription-basics-server.ts` 场景临时扩充验收数据，没有连接生产数据库或真实订阅源。

| 场景 | 观察结果 |
| --- | --- |
| 同一处理链清理前后截图 | 布局、输入和输出列表、计数与按钮外观一致；拉取时间因重启服务改变 |
| 选择正则改名步骤 | 显示当前参数，输入 2、输出 2、改名 1、命中 1 |
| 修改替换文本并保存 | 输出更新为“香港线路 01”；刷新后参数与输出保留 |
| 本地节点粘贴无效 YAML | 显示统一错误弹窗；关闭后原有效配置保留 |
| 粘贴有效节点 YAML，含 `udp: false` | 导入成功；保存、刷新后名称和显式 `false` 保留 |
| 新建订阅后取消、重开 | 列表仍为 2 条；重开名称为空 |
| 创建“清理验收配置” | 列表增加至 3 条并进入新配置详情 |
| 新配置预览 | 返回有效 Mihomo YAML，包含 `MATCH,DIRECT`，检查结果“可以导入”、无问题 |

本次是受影响入口的隔离回归，不是生产或全站端到端验收。没有修改现用弹窗运行时；统一弹窗架构与生命周期单测随前端测试通过。

- [清理前处理链页面](before-source.png)
- [清理后处理链页面](after-source.png)
- [YAML 保存重载与 false 保留](local-yaml.png)

验收结束后，临时服务已停止、监听端口已释放，临时浏览器标签已关闭。没有部署、推送或合并。
