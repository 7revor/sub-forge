# 11 · 前端功能与设计稿覆盖盘点

设计稿：Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)。
原有 21 张画板；本轮在画布底部新增一行「补充设计：编辑细节、列表、对话框与账户」，共 8 张画板。

本文逐页对照 `packages/web`，分三类：

- **有设计**：原画板覆盖，前端按画板实现。
- **补充设计**：前端已有、原画板没画的功能。先补画，再按补充画板重写。
- **有设计、无实现**：画板画了，但数据模型或服务端还没有对应能力，本轮不做。

## 补充画板

| 画板 | 覆盖的功能 | 前端 |
|---|---|---|
| `Pipeline` 订阅源 · 编辑处理步骤 | 选中步骤的参数（右侧灰底区域）、启用 / 删除步骤、添加处理器分组菜单、自动去重兜底行、预览「命中」列与 diff / 节点列表切换 | `components/PipelineEditor.tsx` |
| `PipelineForms` 处理器参数表单 | 12 种处理器的参数表单；多条正则一行一个输入框并显示命中数；步骤出错时的提示 | 同上 |
| `SourceFetch` 订阅源 · 拉取参数与快照 | 名称、类型、多个订阅地址、UA、快照有效期、超时、本地内容；快照历史；删除入口 | `pages/Sources.tsx` |
| `Lists` 列表页 · 订阅源与新建 | 列表页（搜索、计数、状态列）、新建对话框、空列表卡片 | `components/DocList.tsx`、`pages/Sources.tsx` |
| `Dialogs` 对话框与危险操作 | 「更多」菜单 + 删除确认（含被引用原因）、粘贴导入、添加节点集、编辑链规则、插入私有规则、创建用户、表单 / YAML 双视图、离开前保存 | `components/ui.tsx` `Modal`、`components/MoreMenu.tsx`、`components/dialogs.tsx` |
| `TemplateBrowse` 模板 · 普通用户浏览 | 模板列表 + 详情（骨架、规则、版本记录），用模板新建配置订阅 | `pages/Templates.tsx` |
| `Login` 登录 | 登录页 | `pages/Login.tsx` |
| `Account` 账户 | 当前用户信息、修改密码 | `pages/Account.tsx` |

## 有设计

| 画板 | 路由 | 状态 |
|---|---|---|
| 总览 `Main` | `/` | 一致 |
| 订阅源 · 处理链编辑器 `Source` | `/sources/:id` | 按 `Source` + `Pipeline` 重写 |
| 组合 `Collection` | `/collections/:id` | 已重写：成员表（类型、节点数、前后缀）、处理链只读摘要 + `/collections/:id/pipeline` 逐步预览、合并后节点、引用方 |
| 本地节点 `LocalNodes` | `/locals/:id` | 已重写为单页：分组标签、节点表、右侧编辑 |
| Profile · 新建向导 `ProfileNew` | `/profiles/new` | 一致；可从模板页带 `?template=` 预选模板 |
| Profile · 节点集 `ProfileNodeSets` | `/profiles/:id/nodesets` | 已调整：类型、节点数、备注列，添加对话框，输出方式说明 |
| Profile · 代理链 `ProfileChain` | `/profiles/:id/chains` | 已调整：链规则只读卡片，编辑在对话框里 |
| Profile · 概览 / 基础设置 / 策略组 / 规则 / 预览 | `/profiles/:id/:tab` | 一致；删除移到「更多」菜单 |
| 规则集 `RuleSets` | `/rulesets/:id` | 已重写：解析结果表、编辑来源对话框、输出预览、客户端改写 |
| 规则包 `RuleBundle` | `/bundles/:id` | 一致 |
| 模板编辑器 / 发布前校验 | `/templates/:id` | 一致；查看模式改用与浏览页相同的详情 |
| 基础设置预设 `Presets` | `/presets/:id` | 已重写为单页：预设列表、分区跳转编辑、引用方 |
| 用户 `Users` | `/users` | 一致（共享部分见下） |
| 手机 · 订阅链接 `Mobile` | 各页窄屏 | 导航折叠；未逐页核对 |

## 有设计、无实现（本轮不做）

| 画板 / 位置 | 缺什么 |
|---|---|
| 规则仓库 `RuleRepo` | 服务端没有仓库索引与搜索接口 |
| 系统 `System` | 服务端没有 SSRF 白名单管理、mihomo 校验开关、仓库管理、备份恢复接口 |
| 用户 · 共享的订阅源与组合 | 没有共享模型 |
| 组合 · 成员「拉取失败时」 | `Collection.members` 没有失败策略字段 |
| 规则集 · 下载地址 | 管理接口不返回规则集下发地址 |
| Profile · 节点集「下发地址」 | 管理接口不返回 provider 地址 |
| 预设 · Surge 段 | M2 |
| 引用方跨用户统计 | 列表接口只返回当前用户的配置订阅，预设引用方只显示自己的 |
