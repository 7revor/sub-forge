# @sub-forge/web

管理前端：React 19 + React Router 7 + TanStack Query + Tailwind 4，配色与布局取自设计稿（Claude Design 画布「Sub-Forge 前端页面设计」）。

## 开发

```bash
# 终端 1：后端（示例数据见 packages/server/README.md）
SUBFORGE_DB=./data/dev.db PORT=8787 PUBLIC_URL=http://127.0.0.1:5173 pnpm --filter @sub-forge/server start
# 终端 2：前端，/api /sub /p /r 代理到后端
SUBFORGE_API=http://127.0.0.1:8787 pnpm --filter @sub-forge/web dev
```

生产构建由服务端托管（`WEB_DIR=packages/web/dist`），生产镜像已包含，前端与接口同源。

## 页面

| 页面 | 说明 |
| --- | --- |
| 总览 | 配置订阅与订阅源状态，拉取失败的待处理项 |
| 订阅源 / 组合 | 拉取参数、快照历史；处理链编辑器（拖拽排序、启用开关、逐步预览差异） |
| 本地节点 | 按协议的表单（认证、TLS、Reality、传输）、单节点 / 整个分组的 YAML、粘贴导入；前置引用单个节点 |
| 规则集 / 规则包 | 按 mihomo、Android、Surge macOS / iOS 预览最终输出；规则集行级客户端覆盖；规则包子项排序、单条规则表单与 no-resolve |
| 配置订阅 | 新建为 7 步向导（完成时才保存，草稿可预览）；详情七个标签：概览（模板与版本锁定、订阅链接、访问日志）、基础设置（逐项覆盖预设）、节点集、策略组（排序、测速与高级参数、filter 命中预览）、规则（私有规则拖拽、客户端覆盖）、代理链（落地命中、依赖节点面板）、预览 |
| 模板 | 浏览骨架与版本、版本对比；管理员用表单编辑组与规则，或切换为 mihomo YAML；即时自检并定位到组 / 规则、影响分析与发布 |
| 预设 / 用户 | 管理员；预设的 mihomo 段为分组表单 + YAML |

## 编辑方式

表单为主、原始配置为辅（[docs/09](../../docs/09-frontend-forms-plan.md)）：模板、本地节点、基础设置都可以在「表单」与「原始配置（mihomo YAML）」之间切换，两者编辑同一份数据；表单没覆盖的字段在「其他字段」中按键值编辑，不会丢失。原始配置解析出错时不能切回表单，也不能保存。

本地单节点的原始配置按草稿解析：服务器等必填项尚未填写时仍可返回表单继续填写，保存时再校验必填项。YAML 语法错误、重复键或字段类型不能由表单表示时，保留原文并阻止切换与保存；批量导入仍使用严格校验。

Profile 基础设置的无效 YAML 同时阻止分区 / 侧栏导航与向导步骤跳转，支持修复或明确放弃；详情页不会把尚未解析成功的文本显示为“已保存”。模板 YAML 导出使用 `sub-forge-group` / `sub-forge-rule` 注释保留稳定 ID，因此改名或改匹配内容仍能关联已有个人覆盖。复制组或规则时，应删除复制项的 ID 注释，让系统为新项分配 ID。

公共组件在 `src/components/`：`DualEditor`（双视图）、`SchemaForm`（字段描述驱动的表单，字段定义在 `src/schemas/`）、`OverrideField`（逐项覆盖）、`SortableList`（拖拽排序，支持锁定项）、`RuleEditor`、`ClientOverrides`、`NodePicker`、`MatchPreview`。格式转换在 `src/convert/`，都有单元测试。

## 已知简化

- 外部 YAML 没有稳定 ID 注释时，模板导入仍按组名 / 规则匹配项识别；同时删除注释并改名无法可靠识别原组，可能需要重新关联个人覆盖。
- Surge 基础设置只预留了数据结构，表单在 M2。
- 订阅源的处理链需要先保存订阅源才能逐步预览（预览接口按已保存的订阅源取快照）。
- Surge 预览在 M2。
