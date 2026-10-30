# 全局组件库弹层迁移验收

日期：2026-10-30（Asia/Singapore）。分支：`codex/ui-library-motion`。基线：`7e00c34`。实现提交：`f836549`。

## 实现范围

公共弹层采用 shadcn/ui Radix 版的组件结构与标准动画类，保留原有配色和尺寸。动画关键帧来自 `tw-animate-css`，挂载、退场等待、层叠、焦点限制与定位由 Radix 处理。没有再定义业务动画关键帧或固定退场计时器，旧 `Presence.tsx` 已删除。

| 入口 | 当前实现 |
| --- | --- |
| 通用编辑、新建、预览、导入弹窗 | Radix Dialog |
| 删除、未保存离开、恢复备份、重置链接、错误提示 | Radix AlertDialog |
| 单选下拉 | Radix Select，保留现有 option/optgroup API、空值与禁用选项 |
| 多选、自由输入候选、异步来源搜索、规则诊断详情 | Radix Popover，保留业务筛选与选择规则 |
| 添加处理器菜单 | Radix DropdownMenu |
| 成功及带撤销操作的通知 | Sonner，继续通过原 feedbackStore 调用 |

Dialog / AlertDialog 面板使用标准 200ms 淡入淡出与缩放，遮罩及浮层使用默认 150ms；遮罩与面板为同级节点，避免透明度重复叠加。系统减少动态效果使用优先级明确的 `motion-reduce:animate-none!`，不改写库关键帧。Sonner 使用其自带入场、退场和通知计时。

节点候选的自由输入、多选不关闭、异步搜索防抖、诊断悬停后点击固定等业务行为保留。诊断的 150ms 移出宽限仅用于跨越按钮与浮层间隙，不控制动画或卸载。

声明新增运行依赖：`radix-ui@1.8.1`、`tw-animate-css@1.4.0`、`sonner@2.0.8`。解析锁文件对照确认原有 packages 记录均未删除或修改，新增 75 个依赖记录；随后离线冻结安装成功。未安装、启动或调用 Playwright、额外浏览器或其运行时副本。

参考：[Dialog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dialog.tsx)、[AlertDialog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/alert-dialog.tsx)、[Popover](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/popover.tsx)、[DropdownMenu](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx)、[Radix 退场机制](https://www.radix-ui.com/primitives/docs/guides/animation)。

## 检查结果

- `pnpm --filter @sub-forge/web build`：通过，产物 gzip 约 323.15 kB；仍有既有单包大于 500 kB 的提醒。新增 UI 运行依赖带来额外包体积。
- `pnpm typecheck`：核心、服务端、前端全部通过。
- `pnpm --filter @sub-forge/web test`：32 个文件通过，292 项通过、2 项原有跳过。跳过项未计为通过。
- `git diff --check`：通过。

浏览器仅使用 Codex 内置浏览器，测试服务使用内存数据库、虚构账户与节点；核心业务验收使用 `ui-motion.localhost:18642` 独立域名隔离本机其他会话 Cookie。没有修改生产数据库或既有开发服务。

| 场景 | 实测结果 |
| --- | --- |
| 普通新建弹窗 | 打开时计算动画为库的 enter，关闭为 exit；关闭后卸载并返回新建按钮焦点 |
| 遮罩与面板 | DOM 中为同级节点，分别使用默认 0.15s / 0.2s，已移除原父子淡出叠加 |
| 分页单选 | 方向键和回车选择 50 条后 URL 与触发框更新，焦点恢复 |
| 策略组多选 | 选中 SS 后保持展开，空选项清空，Escape 仅关闭浮层，编辑弹窗保留 |
| 弹窗内单选 | SELECT 下拉正常，Escape 不误关下层弹窗 |
| 异步搜索 | 搜索框自动聚焦，无结果状态正常，Escape 只关搜索浮层；选择规则后添加到草稿并正常关闭 |
| 规则预览 | 原文正常展示，退场中内容保持，随后卸载 |
| 远程链接编辑 | 正常打开与取消 |
| 未保存离开 | 实际 role 为 alertdialog，放弃测试草稿后正常导航 |
| 规则诊断 | 本地来源的 2 行诊断可展开、固定与关闭，关闭后不立即重新打开 |
| 处理器菜单 | DropdownMenu 正常展示分组，选择按名称排序后关闭并更新处理链 |
| Sonner 保存通知 | 保存组合后展示库的 success 通知，data-mounted 为 true |
| Sonner 撤销通知 | 格式化展示撤销操作，撤销恢复原文并开始通知退场，没有额外“已撤销”提示 |
| 嵌套错误 | 恢复备份占位接口返回原有 501；错误 AlertDialog 位于恢复确认框上方，关闭后焦点回到下层恢复按钮 |
| 减少动态效果 | 面板与遮罩计算动画均为 none；检查后清除模拟 |
| 390×844 窄屏 | 新建弹窗左右边界 16 / 374px，输入及操作按钮完整可见，随后恢复默认视口 |
| 自由输入节点候选 | 聚焦后保留输入焦点；方向键 + 回车选中示例节点，输入自定义名称时保留文字并显示无结果提示，Escape 不误关链规则弹窗 |
| 控制台 | 最终会话未发现错误或警告日志 |

代表性场景覆盖每类公共弹层，没有逐一点击所有业务页面上的每个实例。实际备份恢复功能仍为原有未实现状态，本次只验证确认和错误流程；节点连通性与公网订阅没有执行。本次未改变领域模型、后端接口、配置输出或示例种子，未编辑外部设计画布，待同步项登记在 docs/13。

## 证据与清理

- `alert-desktop.png`：桌面恢复确认框。
- `dialog-mobile.png`：窄屏新建分组 Dialog。
- `motion-check.json`：最终构建浮层动画实测与关键验收数据。截图用于布局核对，动画结论依据 DOM 状态与计算样式。

已关闭测试标签、清除动效模拟、恢复默认视口并正常停止临时服务，18642 端口不再监听。工作树与分支保留，未合并 main。
