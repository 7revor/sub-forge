# 全部来源与纯节点预览验收

日期：2026-10-30。独立工作树 `codex/chain-all-sources`，基于 `2a24696`。

独立节点预览移除筛选框。代理链前置与落地的 Provider / Inline 来源留空均代表当前订阅对应输出类型的全部来源；placeholder 为「全部」，打开即显示汇总节点。可以选择来源、清空恢复全部、输入正则或点选单个节点。

## 自动验证

- `pnpm typecheck`：通过全部三个包。
- `pnpm --filter @sub-forge/core test`：284 通过、39 条件跳过。增强实际生成内容断言后，`chain-all-sources.test.ts` 的 7 项再次通过。
- `pnpm --filter @sub-forge/web test`：353 通过、2 条件跳过，包含弹窗架构与生命周期单测。
- 后端 `chain-diagnostics-api`、`profile-routing-api`、`chain-source-removal`：15 通过，覆盖全部来源持久化、生成诊断、非法范围拒绝、解除绑定和重新绑定。
- `pnpm --filter @sub-forge/web build`：通过；保留现有大体积产物提示。
- 生成测试覆盖 Mihomo / Stash × Provider / Inline，检查实际节点的 `dialer-proxy`，新增来源、移出来源、按输出类型收窄及循环检测。

## 内置浏览器验收

仅使用 Codex 内置浏览器。API 使用 `test/manual-member-chain.ts` 的内存数据库和虚构账号，端口 18951；Vite 端口 18952，无真实订阅请求或生产数据变更。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 独立来源预览仅节点列表，输入框数量为 0 | passed | `preview-no-filter.png` |
| 三个 Provider 来源均未选，前置及落地立即显示全部 6 个节点 | passed | `all-provider-default.png` |
| 来源选「中转机场」变为 2 个，清空恢复全部，跨来源正则命中 2 / 6 | passed | 浏览器交互；重开截图 |
| 保存后刷新重开仍保留全部来源及两个正则，实际采用香港 IPLC、落地 2 个 | passed | `all-provider-reopened.png` |
| 混合输出切换为全部 Provider 前置 4 个、全部 Inline 落地 2 个 | passed | `provider-inline-default.png` |
| 前置切换 Inline 即显示全部 2 个；点节点后准确设置具体来源和精确名称 | passed | 浏览器交互 |
| 前置与落地为相同的全部范围，显示循环原因并禁用应用 | passed | `all-provider-default.png` |
| 节点预览：关闭按钮、右上角、Escape、遮罩、重开 | passed | `modal-lifecycle.txt` |
| 全部来源代理链：取消、右上角、Escape、遮罩、确认，取消后重开恢复原值 | passed | `modal-lifecycle.txt` |
| 历史具体来源的正则与排除条件保持 | passed | `modal-lifecycle.txt` |
| StrictMode、嵌套子预览关闭后父草稿保留、路由离开取消 | passed | `modal-lifecycle.txt` |
| 统一运行时模拟保存失败后留窗重试，无动画预览关闭与代理链确认 | passed | `modal-lifecycle.txt` |

13 次动画退场均记录 120–122 帧，标题、正文、输入值和布局高度保持一致；14 次受记录的 Promise 均结算一次，嵌套节点预览另有单独退场采样。浏览器控制台错误为 0。无动画场景正常结算，不计入动画帧数。页面保存与模拟失败重试使用虚构内存数据。

未执行：外部真实订阅、真实 Mihomo / Stash 客户端连接、移动端布局、本轮新增的节点查询故障注入。核心中条件跳过的 39 项和前端 2 项不计为通过；未运行整个后端测试集。

临时 API、Vite 和浏览器页在验收完成后停止；不修改主分支或合并本轮工作树。
