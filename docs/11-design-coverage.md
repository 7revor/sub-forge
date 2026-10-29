# 11 · 前端页面与设计稿对照

设计稿：Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)，共 30 张画板：原有 21 张，加上 2026-10-29 补画的 8 张（画布底部「补充设计：编辑细节、列表、对话框与账户」一行），用于前端已有、原画板没画的功能；同日本地节点拆为两张（`LocalNodes` 分组列表与详情、`LocalNodeEdit` 编辑节点）；同日规则包并入规则集，`RuleBundle` 画板换成 `RuleSetNew`（规则集列表与新建），张数不变。

现状（2026-10-29）：`packages/web` 已实现画板对应页面，后续调整中的待同步项见下方清单。画板上有、服务端还不支持的功能，界面照样做出来，服务端先提供占位接口（`packages/server/src/api/pending.ts`）：读接口返回空数据并带 `pending: true`，页面显示「服务端尚未实现」提示；写接口返回 501。

## 画板 → 页面

| 画板 | 路由 | 说明 |
|---|---|---|
| 总览 `Main` | `/` | 四项统计按访问日志与当前模板计算；待处理包括拉取失败、孤儿覆盖项、最近渲染告警、未加入节点集 |
| 订阅源 · 处理链编辑器 `Source` + 补充 `Pipeline`、`PipelineForms` | `/sources/:id` | 基础设置下方为左右排列的步骤列表与总览 / 步骤参数预览；diff 命中列、12 种处理器表单 |
| 补充 `SourceFetch` | `/sources/:id` 的「基础设置」 | 已改为详情页顶部内嵌卡片：单个 URL、名称与拉取选项，表单参考规则集来源设置，快照历史页内展开；删除入口位于页头。旧弹窗画板待同步，见 [13](13-design-canvas-sync.md) |
| 补充 `Lists` | `/sources`、`/collections`、`/locals`、`/profiles` | 搜索、计数、空状态卡片；订阅源新建为对话框；每行「删除」「编辑」 |
| 组合 `Collection` | `/collections/:id` | 成员表含「拉取失败时」；成员表下方直接展开「组合自身的处理链」编辑器与逐步预览，被引用的配置订阅显示为头部徽章。2026-10-29 起 `/collections/:id/pipeline` 跳回详情页 |
| 本地节点 `LocalNodes`、`LocalNodeEdit` | `/locals`、`/locals/:id`、`/locals/:id/nodes/:index` | 分组列表 → 分组详情（节点表）→ 节点编辑子页（表单 / YAML）；2026-10-29 由「分组标签 + 右侧编辑」单页改为三层路由，同日去掉前置卡片与「前置」列，代理链只在 Profile「代理链」中设置 |
| Profile · 新建向导 `ProfileNew` | `/profiles/new` | 可从模板页带 `?template=` 预选 |
| Profile · 概览 / 基础设置 / 节点集 / 策略组 / 规则 / 代理链 / 预览 | `/profiles/:id/:tab` | 头部模板徽章打开模板对话框；节点集「下发地址」显示路径模式 |
| 规则集 `RuleSets` | `/rulesets/:id` | 自上而下：来源（多个远程地址 / 本地规则，可排序、启停，选中后展开地址、格式、缓存等字段）、客户端改写（作用于选中的来源）、输出预览（选中来源时为该来源，本地规则在预览里实时编辑；不选时为合并结果与 domain / classical / ipcidr 统计），每块独占一行。2026-10-29 取消「编辑来源」对话框与「解析结果」表，规则包并入规则集 |
| 规则集 `RuleSetNew` | `/rulesets`、`/rulesets/new` | 列表（名称、来源概况、no-resolve）；新建直接打开与编辑页同一个页面，默认带一个选中的本地来源，不再有单独的新建表单或对话框（2026-10-29 取代原 `RuleBundle` 画板） |
| 规则仓库 `RuleRepo` | `/rule-repo` | 占位接口 |
| 模板编辑器 `TemplateEditor`、发布前校验 `TemplatePublish` | `/templates/:id`、`/templates/:id/publish` | 草稿在两页之间共用；发布页自动试渲染；仅管理员可进入 |
| 补充 `TemplateBrowse` | `/templates` | 2026-10-29 统一为唯一模板入口，仅管理员可见，可新建、编辑与发布；旧 `/templates/manage` 重定向到此页。普通用户在配置订阅向导中选择模板 |
| 基础设置预设 `Presets` | `/presets/:id` | 单页；Surge 段为 M2 占位说明 |
| 用户 `Users` | `/users` | 统计列与共享走占位接口 |
| 系统 `System` | `/system` | 占位接口 |
| 补充 `Dialogs` | 全部详情页 | 头部「更多」菜单与最右侧的独立删除按钮、删除确认、各类对话框、表单 / YAML 双视图、离开前保存（2026-10-29 删除从「更多」菜单移出） |
| 补充 `Login`、`Account` | `/login`、`/account` | — |
| 手机 · 订阅链接 `Mobile` | 各页窄屏 | 390 px 下逐路由检查，页面本身无横向滚动，宽表格在自身容器内滚动 |

## 设计稿待同步

- 2026-10-29 订阅源：原「拉取参数」改为顶部「基础设置」，单 URL、Field / Input 对齐；下方处理链与总览保持左右结构。`Source` / `SourceFetch` / `Pipeline` / `Lists` 按 [待同步要求](13-design-canvas-sync.md) 更新；本轮按用户要求只记录待同步，不修改外部画布。

- 2026-10-29 本地节点粘贴导入：前端补充提示「YAML 支持单个节点、节点列表或带 proxies 的完整配置。」，内核已补齐相应解析。外部 Claude Design 画布打开后要求登录，本轮未能更新 `LocalNodes` / `Dialogs` 画板；前端实际效果见 [验收截图](../research/verification/local-node-yaml-import-20261029/single-node-import.png)。
- 模板入口与空状态：管理员只显示一个「模板」入口，普通用户不显示独立模板页；各页面的空状态统一白底虚线框。画布仍待同步，要求与参考截图见 [13 · 画布待同步](13-design-canvas-sync.md)。
- 2026-10-29 地区旗帜：`PipelineForms` 的「添加旗帜」提示已补充流量、到期说明节点不加旗帜。Claude Design 画布仍要求登录，未能同步该画板文案；前端与内核、服务端预览已同步。

## 下拉组件

2026-10-29 起，前端所有下拉都使用组件库 `components/listbox.tsx`：`Select`（单选，可分组、可带一行说明）和 `Combobox`（可输入，候选项按输入筛选，用于节点名称这类允许填列表之外值的场景），不再使用浏览器原生 `<select>` 弹层和 `<datalist>`。画板里的下拉按同一样式绘制：38 px 触发框 + 右侧箭头，展开后为白底圆角弹层，选中项强调色，分组标题为小号灰字。规则写在仓库 `CLAUDE.md`。

## 后端待实现

| 功能 | 前端 | 服务端现状 |
|---|---|---|
| 规则仓库（RS-07，[08](08-rule-repository-index.md)） | `/rule-repo`、系统页仓库管理 | `GET /api/rule-repos*` 返回空，引用与增删 501 |
| 系统设置 | `/system` | `GET /api/system` 返回空默认值；SSRF 白名单与 mihomo 校验仍由环境变量 `SSRF_ALLOW`、`MIHOMO_BIN` 控制；保存、备份、恢复 501 |
| 共享订阅源 / 组合（SYS-06） | 用户页「共享的订阅源与组合」 | `GET /api/shares` 返回空，写 501 |
| 用户统计列 | 用户页「配置订阅 / 订阅源 / 最近订阅请求」 | `GET /api/users/stats` 返回空，显示「—」 |
| 组合成员「拉取失败时」（COL-05） | 组合成员表 | 字段 `onFail` 随文档保存，渲染尚未读取，目前一律使用快照 |
| 原样片段（BS-04） | 配置订阅「基础设置」 | 字段 `base.raw` 随文档保存，渲染尚未输出 |
| 精确的下发地址 | 节点集「下发地址」 | 管理接口不返回，界面显示路径模式，实际地址以预览为准 |
| Surge（M2） | 基础设置、预设、预览、规则客户端输出里的 Surge 切换 | 显示占位说明 |
| 跨用户的引用方统计 | 预设「引用方」 | 列表接口只返回当前用户的配置订阅 |
