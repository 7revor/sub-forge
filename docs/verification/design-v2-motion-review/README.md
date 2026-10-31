# 全站样式与弹窗退场补充复核

日期：2026-10-31。分支：`codex/design-v2`。延续 [上一轮逐画板记录](../design-v2-pixel-review/README.md)，参考同一份《Sub-Forge 前端页面设计.html》的 21 个画板。本轮补齐兼容入口与退场验收，并修复重新逐页查看发现的遗漏。

## 本轮修复

| 区域 | 发现的差异 | 修复与证据 |
| --- | --- | --- |
| 兼容手写规则 | 弹窗仍宽 672px、表单间距与高级区域不一致 | 改为 520px、字段间距 16px，客户端改写默认折叠；[最终截图](compat-insert-final.png) |
| 兼容远程链接 | 旧大预览面板与 672px 宽度 | 改为 440px，地址与读取同行、紧凑黑底预览及计数；预览内边距 10px 12px；[最终截图](compat-remote-final.png) |
| 并发弹窗 | 同一事件连续 show 时两层互相 aria-hidden，顶层按钮无法正常访问 | 分次提交新会话挂载，保留同一运行时与原动画；未挂载即被取消的会话正常结算；[可访问性记录](concurrent-accessibility.json) |
| 模板详情 | 跟随数量、说明图标、影响检查、复制与新建订阅入口缺失 | 补齐外观与已有接口连接；[详情](template-detail-final.png)、[菜单](template-actions.png)、[复制](template-copy-final.png)、[影响检查](template-impact.png) |
| 仓库管理 | 仍使用旧六列表格；文件名、仓库筛选与分页缺失 | 仓库改卡片行，文件改四列表格；新增服务端先过滤后分页，恢复公共分页组件；[最终页面](repositories-final.png)、[筛选](repositories-filtered.png)、[空结果](repositories-empty.png) |
| 总览 | 长名称挤压最近访问列、表格横向溢出 | 固定状态与时间列、长名称截断；1440px 视口实测表格与父容器均 550px，无横向溢出；[最终页面](overview-final.png) |

左侧导航组件未修改。实际保留 232px 导航，原稿为 216px，导致主内容起点相差 16px；该差异按用户要求保留。

## 页面与组件逐项复核

使用 Codex 内置浏览器，主要视口 1440 × 900，延续上一轮参考图与度量。本目录共 64 张截图、45 次页面状态快照（含修复前后与重复采样，不代表 45 个独立页面），DOM 尺寸与控件信息见 [page-states.json](page-states.json)。截图使用隔离测试数据库和虚构数据，文本记录中的测试令牌已脱敏。较早的加载中截图仅用于排查，最终结论优先引用 `*-final.png` 与成功加载后的截图。

| 原稿画板 | 本轮对应检查 |
| --- | --- |
| 01–03 令牌、组件、诊断 | 按钮、输入、标签、通知、错误、预览报告；对照上一轮组件度量 |
| 04–09 配置订阅 | 节点、分流、策略组、代理链、手写规则、客户端配置、预览及模板关联 |
| 10–14 节点和规则资源 | 订阅源详情与处理链、本地节点及 YAML、规则集合及来源、模板与策略组；全部资源列表 |
| 15 系统管理 | 用户、共享弹窗、账号、系统资源异常与重试入口 |
| 16–17 组合与仓库 | 成员、失败策略、处理链；仓库卡片、文件筛选搜索、分页、空结果 |
| 18–19 浮层与弹窗 | 业务菜单、选择器、正常与禁用按钮；所有 24 个生产弹窗定义 |
| 20–21 总览与登录 | 总览表格列、统计卡、日志区域；登录表单 |

公共按钮高 36px、小按钮高 28px、输入高 36px；普通弹窗 440px、规则弹窗 520px、策略组 1040 × 800px、代理链 840 × 640px。仓库文件单行最终为 41px（文字 20px、上下各 10px、边框 1px）；仓库卡片最小高 52px、间距 8px、圆角 10px。列表、搜索、字段、提示与高级设置按上述画板逐项核对。

仓库交互使用真实索引：总计 5818 条，第二页 21–40、2/291；选定仓库后总计 1602 条且回到 1/81；搜索 OpenAI 得到 3 条；无匹配词显示空态。服务端计数、分页与搜索使用同一仓库过滤条件，未通过前端过滤当前页伪造结果。

## 24 个生产弹窗覆盖

下表每项均完成正常动画与无动画关闭。兼容入口由测试页直接调用生产 createModal 定义，其余业务流程通过完整应用入口或相同生产定义触发；未复制业务弹窗 DOM。

| 定义 | 业务内容 | 证据组 |
| --- | --- | --- |
| ExtraRuleModal | 插入规则、前置规则 | harness-motion-fixed、compat-padding-motion |
| RemoteRuleDialog | 兼容远程链接 | harness-motion-fixed、compat-padding-motion |
| RuleEditDialog | 手写规则 | harness-motion-fixed |
| ProfileInfoModal | 名称与备注 | harness-motion-fixed |
| RulesetSourceDialog | 添加规则来源 | harness-motion-fixed |
| RepositoryModal | 仓库编辑 | harness-motion-fixed |
| NamedCreateDialog | 命名对象 | harness-motion-fixed |
| NodeSetPickerDialog | 节点来源 | harness-motion-fixed |
| MessageModal | 确认、提示、成功、错误 | message-motion-fixed、harness-motion-fixed |
| PromptModal | 单字段输入 | message-motion-fixed、template-actions-motion |
| RuleSourcePreview | 规则预览 | harness-motion-fixed |
| ChainRuleModal | 列表、全部来源、直接点选代理链 | harness-motion-fixed |
| ProfileGroupDialog | 策略组、绑定模板的独立组 | harness-motion-fixed |
| NewProfileModal | 新建配置订阅 | application-normal-fixed、application-none-fixed |
| NewSourceModal | 新建订阅源 | application-normal-fixed、application-none-fixed |
| LocalGroupYamlModal | 本地节点 YAML | application-normal-fixed、application-none-fixed |
| LeaveModal | 未保存离开 | application-normal-fixed、application-none-fixed |
| MemberOptionsModal | 成员失败策略 | application-normal-fixed、application-none-fixed |
| TemplateYamlModal | 模板 YAML 导入 | application-normal-fixed、application-none-fixed |
| TemplateGroupModal | 模板策略组 | application-normal-fixed、application-none-fixed |
| CreateUserModal | 新建用户 | application-normal-fixed、application-none-fixed |
| ShareModal | 共享资源 | application-normal-fixed、application-none-fixed |
| TemplateAssociationModal | 更换分流方式 | application-normal-fixed、application-none-fixed |
| RefreshProgressModal | 刷新资源进度 | application-normal-fixed、application-none-fixed |

证据组名称对应本目录同名 JSON。最终回归汇总 [motion-summary.json](motion-summary.json)：**75 次关闭记录，44 次正常动画、31 次无动画，共采集 1167 个 closed 帧，0 条失败**。汇总仅取 harness-motion-fixed、message-motion-fixed、application-normal-fixed、application-none-fixed、compat-padding-motion、template-actions-motion、template-final-motion，不重复计算历史运行与子集。

DOM 观察器在打开时记录标题、正文、输入值、复选状态、展开状态与 offset 宽高；进入 closed 后逐帧对比，直到实际 detach。offset 尺寸排除官方缩放动画，检查内容布局而非强制屏幕边界不动。无动画允许直接卸载、0 个 closed 帧，另验 Promise 正常完成。此过程保留 Radix 原动画，不固定延时猜测卸载、不冻结交互子树。

补充场景：

- X、取消、Escape、遮罩、确认；取消后重开从外部原值创建草稿。
- 兼容手写规则输入与校验、前置位置、高级区展开；远程地址错误、读取两条规则成功、子确认后父取消不提交。
- 保存首次失败显示错误、草稿保留，第二次重试成功。
- 嵌套取消与父草稿保留；路由离开结束所有会话；StrictMode 下真实 Host 卸载与重新挂载。
- [Host 卸载结果](host-result-fixed.json) 为 cancelled / unmounted；[并发结果](concurrent-outcomes.txt) 包含三次 dismissed 与两次 navigation，没有待结算 Promise。
- 三层连续 show 时只有顶层可访问；逐层关闭后父层恢复可访问且焦点仍在弹窗中，见 concurrent-accessibility.json。
- 早期补充慢动画观察约 2 秒、243 帧，查询正文保持，见 harness-motion.json；其发生于并发挂载修复前，不计入上述最终 75 次回归。

## 自动检查与复现入口

- Web：48 个测试文件，360 通过、2 跳过；包含弹窗架构与生命周期单测。两项跳过为既有 proxyYaml 条件用例，不计通过。
- 服务端：rule-options 14 项通过，覆盖先仓库过滤再分页、搜索、无结果、非法 scope、禁用仓库及不读取正文。
- Web TypeScript 与生产构建通过；服务端 TypeScript 通过。Vite 仍提示主包超过 500kB，为既有体积告警。
- `git diff --check` 通过。没有安装依赖或调用独立 Playwright、Chromium。

启动隔离后端和 Vite 后，内置浏览器打开 `/test/dialog-exit.html` 可运行兼容、嵌套、并发、重试与卸载场景。`/test/design-audit.html?path=/profiles` 先安装观察器再进入完整应用；添加 `&motion=none` 检查无动画。页面隐藏的 `#dialog-motion-results` 提供只读 JSON 结果，观察器不改变生产运行时。测试入口仅用于开发验收。

## 验收边界

本轮已经补齐上一轮未覆盖的两个兼容弹窗、24 个定义的正常/无动画退场与独立 Host 重挂场景。它不代表每种业务数据、每个按钮文案组合的无限全排列。参考图和真实页面的数据量、名称与网络状态不同，且导航按要求保留，因此不宣称整图像素差为零。

模板删除服务端接口尚不存在，菜单明确禁用并标注暂不支持；共享接口仍返回 501、用户统计仍为 pending。这些已有后端能力限制未伪装为成功，本轮完成相应界面和弹窗验收。测试仅使用独立数据库；临时前后端与参考 HTTP 服务在验收结束后停止，工作树保留且不自动合并。
