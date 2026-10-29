# 11 · 前端页面与设计稿对照

设计稿：Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)，共 29 张画板：原有 21 张，加上 2026-10-29 补画的 8 张（画布底部「补充设计：编辑细节、列表、对话框与账户」一行），用于前端已有、原画板没画的功能。

现状（2026-10-29）：`packages/web` 的所有页面都按画板实现。画板上有、服务端还不支持的功能，界面照样做出来，服务端先提供占位接口（`packages/server/src/api/pending.ts`）：读接口返回空数据并带 `pending: true`，页面显示「服务端尚未实现」提示；写接口返回 501。

## 画板 → 页面

| 画板 | 路由 | 说明 |
|---|---|---|
| 总览 `Main` | `/` | 四项统计按访问日志与当前模板计算；待处理包括拉取失败、孤儿覆盖项、最近渲染告警、未加入节点集 |
| 订阅源 · 处理链编辑器 `Source` + 补充 `Pipeline`、`PipelineForms` | `/sources/:id` | 步骤列表、参数区、diff 命中列、12 种处理器表单 |
| 补充 `SourceFetch` | `/sources/:id` 的「拉取参数」 | 对话框：来源与拉取、快照历史、删除入口 |
| 补充 `Lists` | `/sources`、`/collections`、`/profiles`、`/rulesets`、`/bundles` | 搜索、计数、空状态卡片；订阅源新建为对话框 |
| 组合 `Collection` | `/collections/:id`、`/collections/:id/pipeline` | 成员表含「拉取失败时」 |
| 本地节点 `LocalNodes` | `/locals/:id` | 单页：分组标签、节点表、右侧编辑 |
| Profile · 新建向导 `ProfileNew` | `/profiles/new` | 可从模板页带 `?template=` 预选 |
| Profile · 概览 / 基础设置 / 节点集 / 策略组 / 规则 / 代理链 / 预览 | `/profiles/:id/:tab` | 头部模板徽章打开模板对话框；节点集「下发地址」显示路径模式 |
| 规则集 `RuleSets` | `/rulesets/:id` | 解析结果、编辑来源对话框、输出预览、客户端改写、下载地址 |
| 规则包 `RuleBundle` | `/bundles/:id` | 本地规则集在浏览器解析出 behavior 与条数；远程规则集显示为未知 |
| 规则仓库 `RuleRepo` | `/rule-repo` | 占位接口 |
| 模板编辑器 `TemplateEditor`、发布前校验 `TemplatePublish` | `/templates/:id`、`/templates/:id/publish`、`/templates/manage` | 草稿在两页之间共用；发布页自动试渲染 |
| 补充 `TemplateBrowse` | `/templates` | 所有人浏览；管理员多一个「编辑新版本」 |
| 基础设置预设 `Presets` | `/presets/:id` | 单页；Surge 段为 M2 占位说明 |
| 用户 `Users` | `/users` | 统计列与共享走占位接口 |
| 系统 `System` | `/system` | 占位接口 |
| 补充 `Dialogs` | 全部详情页 | 「更多」菜单 + 删除确认、各类对话框、表单 / YAML 双视图、离开前保存 |
| 补充 `Login`、`Account` | `/login`、`/account` | — |
| 手机 · 订阅链接 `Mobile` | 各页窄屏 | 390 px 下逐路由检查，页面本身无横向滚动，宽表格在自身容器内滚动 |

## 后端待实现

| 功能 | 前端 | 服务端现状 |
|---|---|---|
| 规则仓库（RS-07，[08](08-rule-repository-index.md)） | `/rule-repo`、系统页仓库管理 | `GET /api/rule-repos*` 返回空，引用与增删 501 |
| 系统设置 | `/system` | `GET /api/system` 返回空默认值；SSRF 白名单与 mihomo 校验仍由环境变量 `SSRF_ALLOW`、`MIHOMO_BIN` 控制；保存、备份、恢复 501 |
| 共享订阅源 / 组合（SYS-06） | 用户页「共享的订阅源与组合」 | `GET /api/shares` 返回空，写 501 |
| 用户统计列 | 用户页「配置订阅 / 订阅源 / 最近订阅请求」 | `GET /api/users/stats` 返回空，显示「—」 |
| 组合成员「拉取失败时」（COL-05） | 组合成员表 | 字段 `onFail` 随文档保存，渲染尚未读取，目前一律使用快照 |
| 原样片段（BS-04） | 配置订阅「基础设置」 | 字段 `base.raw` 随文档保存，渲染尚未输出 |
| 精确的下发地址 | 节点集「下发地址」、规则集「下载地址」 | 管理接口不返回，界面显示路径模式，实际地址以预览为准 |
| Surge（M2） | 基础设置、预设、预览、规则客户端输出里的 Surge 切换 | 显示占位说明 |
| 跨用户的引用方统计 | 预设「引用方」 | 列表接口只返回当前用户的配置订阅 |
