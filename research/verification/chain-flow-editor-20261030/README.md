# 代理链流量顺序与节点集移出验收

日期：2026-10-30。工作树：`.Codex/worktrees/member-chain-editor`，基线 `0695c9c`。仅使用内存数据库、虚构账号与 `.test` 节点；固定 fixture 禁止上游请求。浏览器为 Codex 内置浏览器，没有运行 Playwright 测试工具。

## 实现范围

- 单页顺序：节点来源 → 代理链 → 策略组 → 规则。节点集行取消整集前置按钮。
- 弹窗先前置、后落地：桌面双列，窄屏上下排列。高 680px（受视口约束），正文滚动，固定底部确认。新增来源及正则为空。
- 前置 Provider 输入正则，展示命中数和当前首个采用节点；Inline 点选；Group 选择。落地 Inline 为单节点，Provider 为整集。
- 旧落地筛选及排除条件保留，主动重新选择才替换。单节点前置继续共用编辑器及外层确认区。
- 移出来源前列出前置、落地及回退中的直接引用链；确认时同时更新节点集和链，取消保持草稿。原始节点源不删除，其他链不受影响。
- 服务端补充落地节点集必须加入本订阅的校验；Mihomo/Stash 沿用已有解析及服务端覆写合同。

Provider 筛选沿用既有 `NodeRef.match.regex` 的首个命中语义，不把多个前置串联或隐式改变原有回退行为。默认 wrap 输出对实际采用节点的精确隐藏组。参考 [Mihomo dialer-proxy](https://wiki.metacubex.one/config/proxies/dialer-proxy/)、[Provider override](https://wiki.metacubex.one/config/proxy-providers/#override)、[group filter](https://wiki.metacubex.one/config/proxy-groups/#filter)。

## 浏览器场景

详细状态及几何数据在 `browser-results.json`。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| Provider 正则前置 → Inline 指定落地，显示多个命中中的首项 | passed | provider-to-inline.png |
| 保存刷新后回显正则与包含特殊字符的节点名 | passed | 浏览器 DOM 回显 |
| Inline 前置 → Provider 整集落地，确认位置不变 | passed | inline-to-provider.png |
| Group 前置 → Provider 整集落地 | passed | 浏览器 DOM 回显 |
| 移出同一来源的前置/落地关联链；取消保留 3 条，确认删除 2 条、保留无关 1 条；保存刷新一致 | passed | remove-confirmation.png |
| 390×844 窄屏上下分块、可到达落地、底栏固定、无横向溢出 | passed | mobile-chain.png、mobile-landing.png |
| 非法正则、同源整集成环阻止应用 | passed | 浏览器禁用状态与错误提示 |
| 旧落地筛选/排除在修改前置、保存刷新后不变 | passed | legacy-range.png |
| 组内前置固定落地、复用底栏，取消组编辑同时撤销链草稿 | passed | 浏览器链数量 0 |
| 最终版本来源初始为空，Provider → Provider 可应用，移出提示显示完整范围 | passed | remove-confirmation-final.png |

桌面两种完整选择组合的对话框均高 680px，footer 顶边 y=634、高 65px；窄屏 footer 顶边 y=656、高 105px，滚动落地前后位置不变。

## 非浏览器验证

- `pnpm --filter @sub-forge/web test`：40 文件，336 passed，2 skipped（既有跳过）。
- 核心相关测试：`chain-materialization`、`chain-safety`、`stash-render`，37 passed。新增验证正则 Provider 前置连接两类落地，Mihomo 与 Stash 一致，整集与单节点作用范围正确。
- 服务端相关测试：`chain-source-removal`、`profile-routing-api`、`api-profile-draft`，13 passed。覆盖残留落地链被拒绝、原保存配置不变、同时移出成功、原始节点文档保留。
- `pnpm -r typecheck`：passed。
- `pnpm --filter @sub-forge/web build`：passed，保留既有大 bundle 提示。
- `git diff --check`：passed。

未运行真实客户端核心或真实网络代理连接；跨客户端结论限于上述配置生成测试。未更改生产数据，也未推送、部署或合并 main。

## 设计稿与清理

外部画布实际访问返回「Sign in to view this page」，修改状态为 **not_run**，截图 `design-canvas-login.png`。待同步布局与文案登记在 `docs/13-design-canvas-sync.md`，未声称远程画布已更新。

临时浏览器标签已关闭，视口覆盖已重置。本轮启动的 API / Vite 已停止；18951、18952 无监听，对应进程与父启动器均退出。
