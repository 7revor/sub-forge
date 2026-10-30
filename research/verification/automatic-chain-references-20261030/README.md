# 自动引用与代理链诊断验收（2026-10-30）

## 改动与隔离边界

- 在 `codex/member-chain-editor` 工作树实现。移除独立依赖节点面板与手工策略；保留底层自动解析、精确隐藏组、安全检查及只读引用详情。
- Mihomo Provider 前置自动生成隐藏组；Inline 直接引用；Stash 沿用全节点集内联转换。旧 `refPolicy` 不影响生成，保存时规范化。节点集 Provider / Inline 选择保留。
- 每条链返回实际前置、命中/应用数量和关联问题；环路也关联到依赖该环的入口，不误报无关链。
- 使用 `manual-member-chain.ts` 内存数据与虚构节点，无真实订阅、数据库或节点流量。浏览器仅用 Codex 内置浏览器。

## 非浏览器验证

| 项目 | 结果 | 证据与边界 |
| --- | --- | --- |
| `pnpm --filter @sub-forge/core test` | passed：274；skipped：39 | `core.log`；真实内核等条件测试未启用 |
| `pnpm --filter @sub-forge/server test` | passed：446；skipped：5 | `server.log`；包括草稿不落库、旧策略规范化、两客户端诊断 |
| `pnpm --filter @sub-forge/web test` | passed：336；skipped：2 | `web.log` |
| `pnpm -r typecheck` | passed | 三包均完成，退出码 0 |
| `pnpm --filter @sub-forge/web build` | passed | `build.log`；仍有大于 500 kB 的构建分块提示 |
| `git diff --check` | passed | 无空白问题 |
| Mihomo / Stash 真实客户端连接 | not_run | 本轮验证配置生成，没有启动客户端或建立真实代理连接 |

## 内置浏览器逐项验证

完整结构化记录见 `browser-results.json`。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 自动显示实际前置、缺失前置、循环；旧面板和策略控件消失 | passed | `chain-diagnostics.png` |
| 修改前置后立即撤下旧诊断，自动重新检查 | passed | 当次 AX 读取三条均显示检查中；完成后实际前置显示日本备用，缺失提示消失 |
| 修复循环并保存刷新 | passed | `resolved-chains.png`；三条链命中数为 1 / 1 / 2，实际前置香港 / 日本 / 香港 |
| Mihomo 自动生成精准隐藏组；详情默认折叠且只读 | passed | `preview-reference-details.png`；重复引用复用两组，保留三个 Provider |
| Stash 自动内联和正确前置 | passed | `stash-auto-translation.png`；六个节点内联，无 Provider、无隐藏引用组 |
| 390px 窄屏 | passed | `mobile-chain-check.png`；页面滚动宽度等于 390，三处结果滚动宽度均等于容器宽度 290 |
| 单独的代理链检查请求失败 | not_run | 停止 API 后认证刷新返回登录页，未能隔离检查接口的失败；见 `service-unavailable-login.png`，不视为通过 |
| 外部设计画布同步 | not_run | `design-canvas-login.png`：实际访问要求登录，未编辑。待同步内容已登记 docs/11、docs/13 |

## 清理

已关闭本轮临时浏览器页并重置视口。终止本轮 API（18951，PID 38451）与 Vite（18952，PID 38440）；检查其父进程与监听端口均无残留。没有推送、部署或修改线上数据；代码在任务收尾单独提交，是否合并由用户决定。
