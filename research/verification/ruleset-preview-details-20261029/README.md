# 来源预览与不支持行详情验收（2026-10-29）

分支：`codex/ruleset-preview-details`。独立运行目录与数据库，前端 15175、后端 18082；Finance 从本地现有规则集复制，未改写用户数据。浏览器仅使用 Codex 内置浏览器。

## 自动验证

- 服务端：225 项通过、3 项原有集成用例跳过。
- 前端：223 项通过、2 项原有测试跳过。
- core / server / web 类型检查通过。
- 服务端新增覆盖多来源切换、停用来源单独预览、合并时各来源诊断明细、100 条详情上限和完整计数。

## 内置浏览器

- 来源甲仅显示 `DOMAIN,alpha.example`，切换来源乙显示 `beta.example` 与 `shared.example`，甲的内容消失。
- 「查看合并结果」显示上述 3 条，排除停用来源；停用来源可单独预览 `disabled.example`。
- 二进制来源显示透传说明，不再显示其他来源内容。
- 不支持行徽标：点击、鼠标悬停与键盘聚焦均显示行号、原文与原因；Escape 关闭；点击其他来源关闭浮层。
- 真实 Finance / PayPal：247 条可解析，第 256 行 `USER-AGENT,PayPal*` 无法解析，原因与来源诊断一致。切换 Wise 后仅显示 `transferwise.com` 与 `wise.com` 两行。截图见 [PayPal 明细](paypal-details.png)。

## 限制

Claude Design 链接显示登录页面，外部画板未同步，已登记到设计对照文档。测试环境在验收后停止，worktree 保留，未合并主分支。
