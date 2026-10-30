# 订阅编辑合并验证（2026-10-30）

范围：将 `codex/member-chain-editor` 的订阅界面改动与 main `377ec99` 整合；主要冲突为静态弹窗迁移与本分支代理链/名称卡片布局。

## 自动验证

- passed：`pnpm -r typecheck`，包括最终纳入最新规则样式后的复验。
- passed：core 277、server 450、web 351 项测试；46 项条件测试 skipped，不计入通过。
- passed：最终前端再次运行 351 passed / 2 skipped，包含弹窗架构与生命周期单测。
- passed：前端构建；保留既有大体积 chunk 警告。
- passed：`git diff --check`。

## 内置浏览器场景

只使用 Codex 内置浏览器，连接本分支内存 fixture（18951 / 18952），无真实订阅源或数据库写入。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 详情名称与模板共用卡片，代理链紧随来源且为文本行 | passed | 订阅合并卡片与代理链.png、最终合并页面.png |
| 正常命中、前置缺失、循环诊断显示在对应链 | passed | auto-chain 页面 AX，三种 fixture |
| 编辑 Provider 正则由香港改为日本，取消后外部仍为香港，重开正确回显 | passed | 代理链静态弹窗.png 与取消后 AX |
| 关闭按钮可关闭代理链弹窗 | passed | 重开后 Close，随后可打开移除确认 |
| 移除前置来源列出 2 条关联链，取消保留 3 条，确认后仅剩无关的 1 条 | passed | 来源移除联动确认.png、操作后 AX |
| 新建订阅名称为空白时创建禁用 | passed | UI enabled 断言 |
| 模板选择取消后重开为空；应用后保留名称、创建成功回显绑定状态 | passed | 创建后名称模板卡片.png |
| 继承组类型与隐藏开关禁用，内置成员候选可见 | passed | 组编辑弹窗 AX |
| 组内更改后 Escape，后续可正常离开页面 | passed | Escape 操作与下一页面 AX；未把 closing 瞬间 DOM 留存当作失败 |
| 390px 窄屏无横向溢出 | passed | 窄屏名称模板卡片.png，文档宽=视口宽=390 |
| 新代理链初始来源为空；Provider 筛选→Inline 选择→应用→保存→刷新回显 | passed | 新建前置落地双列.png、最终合并页面.png |
| 浏览器控制台错误 | passed | 最终 error 日志为空 |
| 本轮逐项重复遮罩关闭、异步失败重试、嵌套、路由关闭、StrictMode、无动画和退场逐帧测试 | not_run | 本轮针对合并冲突做交互回归；生命周期自动测试通过，main 原有完整验收保留在 static-modal/dialog-exit 记录，不冒充本轮逐项浏览器结果 |
| 真实 Mihomo/其他客户端连接 | not_run | 本轮为界面合并，不运行真实代理客户端 |

临时浏览器页已关闭，临时服务完成后停止。分支/工作树保留，不推送、不部署。
