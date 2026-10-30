# 项目规则

- 所有文档、交互与输出使用简体中文。
- 代码修改在独立 Git worktree 中完成，Codex 工作树放在 `.Codex/worktrees/`。完成后自动提交，由用户决定是否合并或删除工作树。
- 浏览器预览、交互、截图与端到端验收统一使用 Codex 内置浏览器（`@Browser`）；不得安装或调用独立 Playwright、Chromium 或其他浏览器替代。临时服务在验收结束后停止。

## 弹窗唯一入口（硬性规则）

- 所有弹窗必须通过 `packages/web/src/modals/index.tsx` 的 `createModal` 定义，并通过静态 `XXXModal.show(data)` 调用，以 Promise 返回结果。简单确认、提示、成功、错误和单字段输入统一使用 `Frame.modal.confirm / alert / success / error / prompt`，它们复用同一个运行时。
- **不允许使用其他形式的弹窗封装**：禁止业务页面直接组合 Dialog / AlertDialog，禁止页面维护弹窗的 visible / open / selected 状态或 JSX 挂载业务弹窗，禁止新增 withModal、独立 createRoot / Portal 弹窗、原生 alert / confirm / prompt 或平行的弹窗管理器。Popover、Select、菜单、Toast 与普通页内编辑不属于弹窗。
- 全站只挂载一个 `ModalRoot`，位于 Router 和 QueryClient Provider 内；底层 shadcn / Radix Dialog 仅供统一运行时内部使用。保留组件库原有动画，不复制 DOM，不以固定延时猜测退场结束。
- 每次 show 的业务 DTO 深拷贝一次；函数、ReactNode、DOM 和页面 Context 不可放入 data。表单用会话内 `useModalDraft` 管理独立草稿；嵌套编辑器及 Context 只能写入该副本，不能携带页面 setter 或共享查询缓存中的可变对象。
- 仅在明确保存、新建、删除等确认操作时提交；编辑结果在 Promise 返回 confirmed 后一次性应用到外部。新增组、规则在保存前不能进入外部列表。取消、关闭按钮、Escape、遮罩与路由离开均不提交；重开从最新外部数据创建新会话。
- `modal.submit` 或 `show(data, { submit })` 负责异步保存：防重复提交，失败留在原弹窗并展示错误，普通关闭在提交期间禁用。路由离开 / Host 销毁会结束会话，晚到响应不能再提交或影响新会话。调用方不能吞掉异常或提前跳转。
- 关闭只进入 closing，标题、正文、输入、成员、展开状态、校验信息和查询展示保留到 Radix Content 实际卸载，随后销毁实例并结算 Promise。查询展示用 `useModalPresentation` 保留最后一次打开时的展示；不能冻结整个交互子树。
- 每个 Promise 必须只结束一次。确认返回 `{ status: 'confirmed', data }`，取消返回 `{ status: 'cancelled', reason }`；取消不能留下 pending Promise 或用异常表示。结果再次深拷贝，保证独立。
- 策略组默认只展开名称、类型、成员；其余选项统一放入默认收起的“高级设置”。
- 新增或调整弹窗必须通过 `src/modals/architecture.test.ts`、生命周期单测及内置浏览器验收。检查所有关闭入口、保存失败重试、重开、嵌套、路由离开、StrictMode、无动画，以及 closed 到卸载期间的标题、正文、输入值和布局高度。完整约定见 [统一弹窗](docs/18-unified-modals.md)。

## 表单规范

- 全项目文本、数值、搜索、YAML、单选、多选及候选输入字段必须有中文 placeholder；Mihomo 字段依据官方中文配置文档说明含义和单位。
- 未配置值保持为空并展示 placeholder，禁止空选项或「未设置 / 不设置 / 不限」占位项目；可选单选通过 `clearable` 清空，多选通过取消勾选清空。
- 提示文字不能写入数据；`false` 和 `0` 不能当作空值。不得通过设置首项或伪默认值掩盖空值。
- 使用公共输入组件的必填 placeholder 类型，保留字段标签；不支持 placeholder 的开关、复选框、文件按钮提供中文标签。
