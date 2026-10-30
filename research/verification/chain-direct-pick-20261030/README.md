# 代理链直接点选验收

日期：2026-10-30。工作树 `codex/inline-via-picker`，基于 `b54ae7b`。

## 范围

- Inline 前置、Inline 落地移除正则输入，展开节点列表直接点选；点选后候选列表保留，标出当前采用或已选节点。
- 策略组前置直接展开组列表，点击选中，不再显示下拉选择器。
- 来源留空继续代表全部；提供恢复全部节点动作。Provider 的正则输入保留。
- 旧 Inline 筛选和排除条件原样回显为选择状态，仅打开、取消或原样确认不改数据；点选节点或恢复全部才替换范围。

## 自动验证

- `pnpm --filter @sub-forge/web test`：353 通过、2 条件跳过，包含弹窗架构、生命周期及节点匹配单测。
- `pnpm typecheck`：core、server、web 全部通过。
- `pnpm --filter @sub-forge/web build`：通过，仍有现有的大产物提示。
- `git diff --check`：通过。
- 首次类型检查发现新增浏览器验收夹具缺少括号，已修复后重新完成类型检查和构建；不计为最终失败。

## 内置浏览器

使用 Codex 内置浏览器、`manual-member-chain.ts` 内存数据和虚构账号。API 端口 18951，Vite 端口 18952，没有读取真实订阅。验收开始使用 `127.0.0.1`；出现会话失效后改用 `inline-via-picker.localhost`，确认登录完成后继续。最终隔离会话控制台无错误。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| Inline 前置与落地同时打开，无文本输入框，全部节点立即展示 | passed | `inline-direct.png`，输入框计数为 0 |
| 点选新加坡前置、名称含 `[01]` 的 GCP 落地，候选列表保留且选中状态正确 | passed | `inline-direct.png` |
| 两侧恢复全部节点，前置恢复首个、落地全部选中；循环提示仍生效 | passed | 浏览器交互 |
| 保存并刷新重开，精确节点保持，配置诊断落地 1 个 | passed | 浏览器交互 |
| 策略组直接展示并点选，保存重开保留选择；更换后取消不提交 | passed | `group-direct.png`、浏览器交互 |
| Provider 的正则输入和首个匹配预览保留 | passed | 历史夹具：日本 IEPL |
| 取消、右上角关闭、Escape、遮罩、确认、重开与 StrictMode | passed | `lifecycle-first-session.txt` |
| 历史 Inline 范围及排除条件原样确认后保留 | passed | `lifecycle-isolated-session.txt` 的 confirmed 数据 |
| 嵌套节点预览返回后父草稿保留、路由离开取消 | passed | `lifecycle-isolated-session.txt` |
| 统一运行时模拟保存失败留窗、重试成功，无动画确认与取消 | passed | `lifecycle-isolated-session.txt` |

两份记录合计 11 次动画退场、每次 120–121 帧，标题、正文、输入值及高度保持一致。其中首次会话最后一次是「未登录」节点加载错误状态的关闭；旧规则的正常加载与保留范围在独立会话中重新验证。无动画确认与取消正常结算，不计入动画帧数。第一份记录 7 次 Promise，第二份 5 次，均只结算一次；嵌套节点预览另有退场记录。

未执行：真实客户端连通性、移动端布局、超过 5000 节点的大列表实测，以及后端全量测试。核心与服务端实现未变。

验收结束停止本轮 API、Vite，关闭临时浏览器页。修改提交到独立工作树，等待用户决定合并或清理。
