# 订阅弹窗修复合并验证

2026-10-30；目标 main 基线 fe9b934；原修复提交 1a2f52a 经 rebase 为 f6f4a5c。

主分支新增的表单规范与修复在 8 个文件重叠。整合保留必填中文 placeholder、无空 option、clearable、规则浮层/尺寸改动，以及本次固定弹窗、只读状态、成员入口和单次确认。未修改历史验收记录。

## 当前验证

- 前端：325 passed / 2 skipped，39 个测试文件。
- 相关后端：profile-routing-api、api-profile-draft 共 12 passed。
- Core、Server、Web 类型检查及 Web 生产构建 passed；仍有既有大包体积提示。
- git diff --check passed；range-diff 已核对修复提交保留。

## 内置浏览器复核

继续使用内存数据库、虚构数据和禁止上游访问的 manual-member-chain 隔离服务。桌面视口 1280 × 720。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 全 Provider 默认入口 | passed | Provider 区域在前；Inline 分类禁用；排除协议显式禁用 |
| 只读类型与 clearable | passed | 类型禁用，点击不产生 listbox；lazy=false 显示关，清空按钮禁用；readonly-settings.png |
| 空模板与清空 | passed | 清空模板恢复中文 placeholder、应用禁用；选项只有三份真实模板，无空项目 |
| 固定组弹窗 | passed | 成员与设置切换后高688、底栏 y=638 不变 |
| 固定模板/前置弹窗 | passed | 清空模板、切换前置来源后高680、底栏 y=634 不变；measurements.json |
| 解除关联与保存回显 | passed | 一次应用转独立；清空 lazy、填 interval=0 后保存刷新，lazy 为空提示而 interval 仍为0；cleared-and-zero.png |
| 控制台 | passed | 最终 error/warn 为空 |
| 窄屏全流程、节点请求失败注入 | not_run | 本轮仅复核冲突涉及的桌面控件；窄屏证据沿用修复阶段，失败重试仍未注入 |
| 外部设计画布 | not_run | 本轮未编辑或重试，待同步状态记录于 docs/13 |

截图及尺寸来自整合后的代码。测试标签已关闭；停止本轮 18951/18952 服务后执行 main 快进合并。工作树与分支保留，不推送。
