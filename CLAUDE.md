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

### 表单 placeholder 与空值（硬性规则）

- 全项目可输入文字或数值的表单项、搜索框、原始配置编辑器、单选、多选及可输入候选框必须提供有意义的简体中文 `placeholder`，动态字段、弹窗和键值行同样适用；不得使用空字符串或仅写「请选择」「未设置」。保留独立字段标签，placeholder 不替代标签。复选框、开关、文件选择按钮等不支持 placeholder 的控件必须有中文标签。
- Mihomo 配置项必须根据 [官方中文配置文档](https://wiki.metacubex.one/config/) 解释字段用途、格式和必要单位，集中维护于 `packages/web/src/schemas/placeholders.ts`。非 Mihomo 业务字段按实际用途解释；其他客户端独有字段使用其自身语义，不照搬不兼容的 Mihomo 说明。
- 默认未配置的项保持空值，以 placeholder 展示提示；禁止用空 `<option>`、空白菜单项或「未设置 / 不设置 / 不限」伪选项占位。可选单选使用公共 `Select` 的 `clearable` 清空，恢复 placeholder；多选取消全部勾选后恢复 placeholder。不得为显示提示而自动选择首项、写入示例值或写入内核默认值。
- `false`、`0` 和明确选择的业务值不等于空值。清空可选配置字段必须按现有模型删除或恢复继承，禁止把 placeholder、空值哨兵写入保存数据或生成配置。
- 公共输入组件和 `FieldSpec` 的 `placeholder` 为必填类型，不得改为可选来绕过检查。新增字段须同时补充中文说明；交互变化须验证空值、选值、清空、保存及回显，并使用 Codex 内置浏览器验收。

- 所有下拉选择一律使用组件库 `packages/web/src/components/listbox.tsx` 的 `Select`（单选）或 `Combobox`（可输入 + 候选项），不允许使用浏览器自带的下拉：不写原生 `<select>`、`<datalist>` / `<input list>`。组件库缺少某种下拉形态时，先在组件库中补充，再在页面中使用。
- 设计稿画板中的下拉同样按组件库样式绘制（触发框 + 自绘弹层），不画浏览器原生下拉或提示框。
