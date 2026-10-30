# 统一弹窗

2026-10-30：本规范是全项目唯一弹窗接入约定，替代受控 Dialog / AlertDialog、页面 visible 与 JSX 挂载。不得新增其他形式的弹窗封装。

## 调用

简单交互与 item-web 的 Frame 命名一致，复用唯一运行时：

```tsx
const result = await Frame.modal.confirm({
  title: '删除此文档？', description: '删除后无法恢复。',
  confirmLabel: '删除', danger: true,
}, { submit: async () => { await api('DELETE', `/documents/${id}`); } });
if (result.status === 'confirmed') navigate('/documents');

const name = await Frame.modal.prompt({
  title: '重命名', initialValue: value.name, placeholder: '填写新的名称',
});
if (name.status === 'confirmed') setDraft({ ...value, name: name.data });
```

`Frame.modal.alert / success / error` 用于需用户确认已读的提示。普通短通知继续使用现有 Sonner 通知队列，不改成阻断弹窗。

复杂表单通过 `createModal<Props, Result>(Body)` 定义；Body 接收 `{ data, modal }`，组合 `ModalContent / ModalHeader / ModalTitle / ModalFooter`，表单状态用 `useModalDraft`。页面仅 `await BusinessModal.show(data)` 并处理结果，不能挂 JSX。参数只能是可 structuredClone 的 DTO；操作函数放第二个参数 `{ submit }`，不能混入数据。

## 数据、生命周期与错误

- 打开时与输出时分别深拷贝；页面草稿、查询缓存、ProfileContext 不与弹窗共用可变对象。Profile 弹窗通过 `profileModalData` 提取 DTO，并构造只修改本会话的 Context。
- 输入和预览不提交；确认调用 `modal.confirm(value)`，异步保存用 `modal.submit(async () => result)`。保存失败留在原窗，错误可见；弹窗提交使用的 Query mutation 标记 `meta.modalErrors: true`（`useSaveDoc(kind, true)`），由会话展示错误，避免全局重复提示；重复提交被控制器拦截。导航必须在 confirmed 结果交付后执行。
- 取消返回 cancelled；提交期间普通关闭被阻止，路由变化与 Host 销毁仍能终止会话。运行中的请求可能已在服务器执行，取消不代表服务器回滚；客户端过期结果不能写入外部或新会话。
- 会话从 open 进入 closing 时保留完整内容。Radix Presence 监听实际动画结束；Content ref 真正 detach 后销毁并结算 Promise。微任务只用于排除 StrictMode 同步重挂，不替代动画事件、不按毫秒猜退场。
- 查询展示在关闭时通过 `useModalPresentation` 保留。嵌套会话独立结算，焦点回到原触发器；连续打开时不让下层退场抢走上层焦点；顶层关闭且仍有父弹窗时，焦点不能退到背景页面。
- 全局一个 ModalRoot，位于 Router 与 QueryClient Provider 内。底层官方组件只供运行时使用。渲染异常有可关闭的错误界面，不能留下悬空 Promise。
- 策略组默认展示名称、类型、成员；其他设置折叠到高级设置。

## 检查与范围

`controller.test.ts` 检查深拷贝、取消路径、一次结算、防重、失败重试、导航与晚到响应；`architecture.test.ts` 扫描业务直接引用底层 Dialog、原生提示、页面挂载业务弹窗和自行创建弹窗根。工具栏布局 Portal 不是弹窗；仅允许已识别的工具栏挂载用途。

内置浏览器通过 `packages/web/test/dialog-exit.html` 逐帧验证关闭到实际卸载的高度、文本、输入值，并检查 StrictMode、无动画、嵌套和路由。业务页面使用虚构数据与内存后端验收。不得改用独立 Playwright 或其他浏览器。

本次仅调整前端交互架构，不改变服务端接口、持久化数据、领域模型、渲染语义或示例种子。外部设计画布待同步状态记录在文档 13；历史验证记录保持原样。
