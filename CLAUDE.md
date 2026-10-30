# 项目规范

## 设计稿、前端、后端三处同步（硬性规则）

任何功能、交互、文案或数据模型的变动，都必须在同一个任务里同步修改以下三处，缺一处不算完成：

| 位置 | 内容 |
|---|---|
| 设计稿 | Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)：修改受影响的画板（控件、文案、示例数据都要一致） |
| 前端 | `packages/web` |
| 后端 | `packages/server`，以及领域模型与渲染所在的 `packages/core` |

同时更新相关文档：

- `docs/02-PRD.md`：需求条目（需求被移除时注明日期与替代方案，不直接删掉条目）
- `docs/03-domain-model-and-pipeline.md`：领域模型
- `docs/05-roadmap-and-open-questions.md`：实现状态
- `docs/11-design-coverage.md`：画板与页面对照、后端待实现
- 各包的 `README.md`、示例种子 `packages/server/examples/seed.example.json`

某一处暂时做不了时（例如服务端还没实现），按 `docs/11` 的约定处理：前端照画板实现，服务端提供占位接口，并登记到 `docs/11` 的「后端待实现」表，不能只改其中一处。

`docs/` 以外的历史验证记录（`research/verification/`）保持原样，不随功能变动修改。

## 前端组件

- 所有编辑弹窗的数据隔离、保存、取消及退场规则统一遵循 [AGENTS.md](AGENTS.md) 的“弹窗状态与保存”：打开时深拷贝独立草稿，只有明确保存才一次性同步到外部，关闭不提交且退场前不清空内容；嵌套编辑器与 Context 不得绕过这一边界。

- 所有下拉选择一律使用组件库 `packages/web/src/components/listbox.tsx` 的 `Select`（单选）或 `Combobox`（可输入 + 候选项），不允许使用浏览器自带的下拉：不写原生 `<select>`、`<datalist>` / `<input list>`。组件库缺少某种下拉形态时，先在组件库中补充，再在页面中使用。
- 设计稿画板中的下拉同样按组件库样式绘制（触发框 + 自绘弹层），不画浏览器原生下拉或提示框。
