# 设计稿逐页复核与补齐（第二轮）

日期：2026-10-31。工作树：`.Codex/worktrees/design-v2`；分支：`codex/design-v2`。

本轮针对用户指出的遗漏，重新读取原 HTML 中全部 21 个画板，对照真实页面、弹窗和浮层修正。此前的“已还原”不能作为全站像素一致的验收结论；本报告记录本轮实际证据与范围。

## 检查方法

- 参考文件：`/Users/7revor/Downloads/Sub-Forge 前端页面设计.html`。解包静态画板，恢复导出器编码的原生表格标签与 SVG viewBox，使用项目已有 Inter / JetBrains Mono 字体加载参考页面。
- 浏览器仅使用 Codex 内置浏览器。主要截图视口 1440 × 900；额外检查 1024 × 768 策略组弹窗。单张 JPEG 的原始尺寸为准。
- 逐页观察截图，同时读取控件宽高、字号、行高、内边距、圆角、边框和背景色。参考采样在 `reference/metrics.json`，实际采样在 `actual/metrics.json`。
- 使用 `/tmp/sub-forge-v2-test/test.db` 独立测试数据库；截图中的节点、账号和令牌均为测试数据。没有修改正式数据库，没有执行密码或令牌重置。
- 左侧导航按用户要求保留，导航组件没有改动。原稿导航宽 216px，现有导航宽 232px，因此内容区绝对横坐标相差 16px；不能为了整图对齐而改导航。

## 本轮补齐内容

1. 统一普通弹窗 440px、规则编辑 520px、代理链 840 × 640px、策略组 1040 × 800px；修复表单内嵌页脚漏用公共边距的问题。
2. 策略组恢复行内名称/类型、360px 右侧成员预览、默认收起的高级设置；预览读取真实节点，补充失败重试和数量截断提示。
3. 代理链恢复双卡片、来源下拉、搜索图标、计数条与列表边界；展开节点支持多选，保存为现有精确正则筛选，空选择不会变成全部。搜索不清除列表外的已选项。
4. 规则添加菜单恢复手写、仓库、集合、远程四种入口；手写区缩到 140px 并增加统计条、模板前后位置、客户端改写折叠区；远程地址增加显式读取和结果反馈。
5. 出口菜单补充策略组搜索；单节点浮层改为 420px、来源/匹配并排，取消不写入外部。修复下拉菜单退场焦点使新浮层瞬间关闭的问题，使用真正的关闭回调交接焦点，没有固定延时。
6. 本地节点恢复列表/编辑双栏、服务器与连通性列、顶部测试操作；代码编辑器统一白底、行号栏和工具条。
7. 列表备注回归名称副行；修正行高、分页、空白占位、访问日志五列与总览状态列；规则搜索框固定 220px，避免操作区换成两行。
8. 订阅源基本信息恢复三列，处理链左栏 340px，并补最终节点数；客户端配置树支持折叠；预览恢复内核顺序、客户端宽度及右侧问题面板。
9. 账户令牌和三列密码区、用户表列序、创建用户角色分段/权限开关、共享多选、仓库扫描位置、登录页标志与脚注逐项对齐。
10. 详情及列表的复制订阅操作创建独立副本；危险操作置于菜单末尾。系统异常资源增加“立即重试”，服务端仅允许管理员刷新已有资源键，不能传任意 URL；刷新进度复用统一弹窗。

## 画板对应检查

| 画板 | 对应页面/组件 | 实际截图示例 |
| --- | --- | --- |
| 01 主题规范 | 颜色、字体、边框、圆角、阴影、页面留白 | 全部实际截图及尺寸 JSON |
| 02 组件 | 按钮、输入、标签、分段、菜单、禁用态 | `modal-create-user`、`menu-rule-target`、`modal-share` |
| 03 问题定位 | 预览右栏、错误位置与诊断 | `profile-preview`、`modal-save-error` |
| 04 订阅节点 | 来源、引用/展开、代理链 | `profile-nodes`、`modal-node-source-picker` |
| 05 分流 | 策略组、规则、MATCH、模板 | `profile-routing` |
| 06 策略组弹窗 | 成员、预览、筛选、高级设置 | `modal-group`、`modal-group-advanced`、`popover-member` |
| 07 配置弹窗 | 代理链、手写规则、更换分流方式 | `modal-chain`、`modal-chain-multiple`、`modal-handwritten-rule`、`modal-template-association` |
| 08 客户端配置 | 左树、白色编辑器 | `profile-client` |
| 09 预览 | 工具条、生成内容、诊断面板 | `profile-preview` |
| 10 订阅源处理链 | 基本信息、步骤、输入/输出 | `source-detail`、`menu-pipeline-step` |
| 11 统一列表 | 配置订阅、订阅源、本地、组合、集合、模板 | 同名列表截图 |
| 12 规则集合 | 来源列表、原文预览、增强设置 | `ruleset-detail`、`modal-ruleset-source-local`、`modal-nested-rule-preview` |
| 13 模板 | 基础信息、策略组、规则、导入 | `template-detail`、`modal-template-yaml`、`modal-template-group` |
| 14 本地节点 | 节点表、YAML、校验、操作 | `local-detail`、`modal-local-yaml` |
| 15 系统/用户/账户 | 设置行、表格、共享、密码区 | `system`、`users`、`account` |
| 16 组合 | 成员、失败策略、处理链 | `collection-detail`、`modal-member-failure` |
| 17 仓库 | 仓库列表、添加/编辑、扫描位置 | `repositories`、`modal-repository`、`modal-repository-extra-location` |
| 18 浮层 | 出口、节点、成员、更多、添加菜单 | `menu-rule-target`、`popover-single-node`、`popover-member`、`menu-profile-detail` |
| 19 其余弹窗 | 新建、名称备注、复制、删除、刷新、用户、共享、重置、离开 | 见下方完整截图索引 |
| 20 总览 | 指标、最近请求、资源状态 | `overview` |
| 21 登录 | 标志、表单、按钮、脚注 | `login` |

## 尺寸复核

| 对象 | 原稿目标 | 浏览器实测 |
| --- | --- | --- |
| 普通按钮 / 小按钮 | 高 36 / 28px，圆角 8 / 6px | 36 / 28px，8 / 6px |
| 普通输入框 | 高 36px，边框 #D5D9E0，圆角 8px | 36px，rgb(213,217,224)，8px |
| 策略组 | 1040 × 800px | 1040 × 800px |
| 代理链 | 840 × 640px | 840 × 640px |
| 手写规则 / 分流方式 | 宽 520px | 520px |
| 新建订阅 / 仓库 / 用户 / 密码提示 | 宽 440px | 440px |
| 单节点浮层 | 宽 420px | 420px |
| 普通弹窗圆角 | 12px | 12px |
| 策略组 1024 × 768 视口 | 不超出视口 | 1024 × 736px，无横向溢出 |

弹窗高度随字段、错误与数据变化；只有明确固定高度的工作区按固定值比较。参考页面与实际页面的列表条数、名称、网络状态不同，未执行整页图像差值为零的自动断言。

## 交互与状态验收

- 手写规则输入后取消，重开为空；单节点浮层取消后出口与页面保存状态不变。
- 策略组高级设置默认收起、展开正常；成员查询和失败反馈可展示；嵌套规则原文关闭后回到外层表单。
- 下拉搜索“香港”只保留相应策略组；从菜单选单节点后浮层持续显示。
- 代理链落地从两项全选取消香港后显示 1 / 2，循环错误消失；搜索 HK 时日本选择仍保留；取消全部后禁用保存。保存到页面草稿后重开仍保持日本选中，最终放弃测试草稿，外部文档保持原状。
- 真实复制订阅成功生成新 ID，原订阅保留。
- 远程规则无效测试地址返回错误，弹窗保持打开，读取按钮恢复可操作。
- 停止测试后端使新建请求失败，弹窗显示 HTTP 500 且名称保留；恢复后端后在原弹窗再次提交，成功创建。另测浏览器断网：查询库暂停提交，恢复网络后自动继续，没有把暂停误记为保存失败。
- 新建订阅可切换跟随模板；遮罩关闭时观察到标题、字段与模板选择仍保留于退场快照，之后卸载。代理链在 reduced-motion 下 Escape 能关闭且不提交。
- 本地节点离开确认：继续编辑保留输入，放弃修改允许路由离开。删除、密码重置、令牌重置只检查弹窗和取消，不执行实际危险操作。
- 系统“立即重试”创建真实资源刷新任务并打开进度弹窗。

## 自动检查

- 前端：48 个测试文件，360 项通过，2 项按既有条件跳过。跳过来自 `proxyYaml.test.ts` 的 `skipIf(!proxies.length)`，没有计为通过。
- 前端生产构建和 TypeScript 检查通过；保留 Vite 主包大于 500kB 的体积提示（本轮未进行拆包）。
- 后端：系统重试与资源刷新两个测试文件、7 项通过；后端 TypeScript 检查通过。包含匿名 401、普通用户 403、未知资源 404、只刷新指定资源的断言。
- 统一弹窗架构测试及控制器生命周期测试包含于前端全量检查：独立草稿、重复提交、失败重试、路由取消、晚到响应、嵌套和 Host 销毁。
- `git diff --check` 通过。没有安装或调用独立 Playwright / Chromium。

## 验收边界

- 共享后端目前仍返回 501，用户统计接口仍为 pending；本轮还原其页面与弹窗，未把空统计或共享操作伪装成已实现。
- `ExtraRuleModal` 与旧 `RemoteRuleDialog` 的兼容入口做了源码/架构检查，未通过当前测试文档触达其独立浏览器流程；不能将其记作浏览器通过。
- 全部业务弹窗的退场每一帧、每一种按钮内容组合和所有异常数据排列未逐帧自动测量。关闭期间内容保留有实际快照与生命周期测试支持，但不等于全排列视觉验收；StrictMode 的独立重挂载场景没有单独浏览器注入测试。
- 订阅源失败样例使用故意无效的测试地址，成功节点/处理链通过本地节点与组合检查；未用真实外部订阅凭证验收。
- 开发热更新过程中出现过旧 Context/旧组件状态失配，整页重载后重新验收；不将开发中的报错历史隐去或当作最终正常运行的结果。

## 完整截图索引

共 65 个实际状态，另有 21 张参考画板截图。

- [modal-group](actual/modal-group.jpg)
- [popover-member](actual/popover-member.jpg)
- [modal-group-advanced](actual/modal-group-advanced.jpg)
- [profile-nodes](actual/profile-nodes.jpg)
- [modal-chain](actual/modal-chain.jpg)
- [modal-node-source-picker](actual/modal-node-source-picker.jpg)
- [profile-routing](actual/profile-routing.jpg)
- [modal-template-association](actual/modal-template-association.jpg)
- [menu-add-rule](actual/menu-add-rule.jpg)
- [modal-handwritten-rule](actual/modal-handwritten-rule.jpg)
- [modal-repository-rule](actual/modal-repository-rule.jpg)
- [modal-collection-rule](actual/modal-collection-rule.jpg)
- [modal-remote-rule](actual/modal-remote-rule.jpg)
- [menu-rule-target](actual/menu-rule-target.jpg)
- [popover-single-node](actual/popover-single-node.jpg)
- [profile-client](actual/profile-client.jpg)
- [profile-preview](actual/profile-preview.jpg)
- [overview](actual/overview.jpg)
- [profiles](actual/profiles.jpg)
- [sources](actual/sources.jpg)
- [source-detail](actual/source-detail.jpg)
- [locals](actual/locals.jpg)
- [local-detail](actual/local-detail.jpg)
- [collections](actual/collections.jpg)
- [collection-detail](actual/collection-detail.jpg)
- [rulesets](actual/rulesets.jpg)
- [ruleset-detail](actual/ruleset-detail.jpg)
- [templates](actual/templates.jpg)
- [template-detail](actual/template-detail.jpg)
- [repositories](actual/repositories.jpg)
- [repository-legacy-new](actual/repository-legacy-new.jpg)
- [system](actual/system.jpg)
- [users](actual/users.jpg)
- [account](actual/account.jpg)
- [modal-new-profile](actual/modal-new-profile.jpg)
- [menu-profile-list](actual/menu-profile-list.jpg)
- [modal-copy-profile](actual/modal-copy-profile.jpg)
- [modal-profile-info](actual/modal-profile-info.jpg)
- [modal-refresh](actual/modal-refresh.jpg)
- [modal-new-source](actual/modal-new-source.jpg)
- [modal-local-yaml](actual/modal-local-yaml.jpg)
- [modal-new-local](actual/modal-new-local.jpg)
- [collection-new](actual/collection-new.jpg)
- [modal-member-failure](actual/modal-member-failure.jpg)
- [modal-ruleset-source-local](actual/modal-ruleset-source-local.jpg)
- [modal-nested-rule-preview](actual/modal-nested-rule-preview.jpg)
- [modal-ruleset-source-remote](actual/modal-ruleset-source-remote.jpg)
- [modal-template-yaml](actual/modal-template-yaml.jpg)
- [modal-template-group](actual/modal-template-group.jpg)
- [modal-repository](actual/modal-repository.jpg)
- [modal-repository-extra-location](actual/modal-repository-extra-location.jpg)
- [modal-create-user](actual/modal-create-user.jpg)
- [modal-share](actual/modal-share.jpg)
- [menu-pipeline-step](actual/menu-pipeline-step.jpg)
- [modal-leave](actual/modal-leave.jpg)
- [modal-new-profile-template](actual/modal-new-profile-template.jpg)
- [modal-save-error](actual/modal-save-error.jpg)
- [save-retry-success](actual/save-retry-success.jpg)
- [menu-profile-detail](actual/menu-profile-detail.jpg)
- [modal-delete-confirm](actual/modal-delete-confirm.jpg)
- [modal-group-1024](actual/modal-group-1024.jpg)
- [login](actual/login.jpg)
- [modal-reset-token](actual/modal-reset-token.jpg)
- [modal-reset-password](actual/modal-reset-password.jpg)

- [modal-chain-multiple](actual/modal-chain-multiple.jpg)

参考图：[01](reference/01.jpg)、[02](reference/02.jpg)、[03](reference/03.jpg)、[04](reference/04.jpg)、[05](reference/05.jpg)、[06](reference/06.jpg)、[07](reference/07.jpg)、[08](reference/08.jpg)、[09](reference/09.jpg)、[10](reference/10.jpg)、[11](reference/11.jpg)、[12](reference/12.jpg)、[13](reference/13.jpg)、[14](reference/14.jpg)、[15](reference/15.jpg)、[16](reference/16.jpg)、[17](reference/17.jpg)、[18](reference/18.jpg)、[19](reference/19.jpg)、[20](reference/20.jpg)、[21](reference/21.jpg)。
