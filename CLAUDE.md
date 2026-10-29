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
