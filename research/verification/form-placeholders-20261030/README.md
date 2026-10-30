# 表单中文 placeholder 与空值验收

- 日期：2026-10-30；分支：`codex/form-placeholders`；基线：`b55362d`。
- 范围：Mihomo 基础设置 49 项、Stash 基础设置 11 项、节点协议 schema，以及全站业务表单和公共选择组件。
- 资料：已核对 [全局配置](https://wiki.metacubex.one/config/general/)、[DNS](https://wiki.metacubex.one/config/dns/)、[嗅探](https://wiki.metacubex.one/config/sniff/)、[代理端口](https://wiki.metacubex.one/config/inbound/port/)、[TUN](https://wiki.metacubex.one/config/inbound/tun/)、[代理组](https://wiki.metacubex.one/config/proxy-groups/)、[出站代理](https://wiki.metacubex.one/config/proxies/)、[TLS](https://wiki.metacubex.one/config/proxies/tls/) 与 [传输层](https://wiki.metacubex.one/config/proxies/transport/) 的中文说明。提示采用用途摘要，不将文档示例或内核默认值当作用户填写值。

## 自动检查

- 前端类型检查通过；公共输入组件、选择组件及 FieldSpec 的 placeholder 为必填。
- 前端全量测试：34 个文件通过，299 项通过，2 项原有跳过项保留；随后补充继承空字符串/列表/对象场景，相关文件 4 项定向测试及最终类型检查通过。
- 新回归覆盖所有 schema 的中文提示、空 Select、旧空 option 防御、数值 0、布尔 false 与清空删除空父对象。
- TypeScript AST 全项目检查：113 个直接表单控件调用均有 placeholder，未发现空 option；属性透传由必填类型检查。原生复选框和文件选择器不支持 placeholder，保留中文标签；异步选择器沿用其中文 label 和内部搜索 placeholder。
- 生产构建通过；仍有原有大资源包提示（主包超过 500 kB），不是构建错误。

## Codex 内置浏览器

使用工作树前端 5197、测试后端 8197、独立 `/tmp/sub-forge-placeholders-test/db.sqlite`，不接触现有业务数据库。测试过程中切换为 `localhost` 隔离本机其他端口的会话 Cookie。

1. 创建「中文占位验收」预设，空文本、数字、布尔和枚举字段显示中文用途说明。
2. `allow-lan` 下拉只有「开启 / 关闭」，没有「未设置」或空白菜单项。
3. 选择「关闭」并发布，重新加载后仍显示关闭，确认 false 没有被当成空值。
4. 点击独立清空按钮，恢复中文 placeholder；发布并重新加载，原始 YAML 不再含 `allow-lan`，也不含提示文字。
5. DNS 策略新增键值行，两侧分别显示域名匹配条件和 DNS 地址说明。填写 `+.example.test → 1.1.1.1, 8.8.8.8` 并发布，原始 YAML 正确保存为两个服务器的列表。
6. 从页面 DOM 检查全部已挂载的基础输入（含折叠分区与其他字段）：均有非空中文 placeholder。
7. 键盘 Enter 激活 `mode` 的清空按钮后，恢复枚举 placeholder，焦点返回下拉；随后放弃测试修改。
8. Stash 通用和 DNS 分区的空布尔、枚举与文本提示正常。
9. 桌面与 390×844 窄屏检查通过，窄屏 `document.scrollWidth === innerWidth === 390`，清空按钮与下拉箭头可区分，无页面横向溢出。

截图：[桌面](desktop.png)、[窄屏](mobile.png)。

未逐一进行所有业务页面的保存操作；全局覆盖由源码扫描、类型检查和已有测试验证，浏览器操作集中于共用控件与基础预设的保存链路。

## 设计同步与清理

项目外部设计画布实际访问仍显示「Sign in to view this page」，未修改；按项目约定登记到 docs/11 和 docs/13。后端接口、领域模型、示例种子无需变更，相关说明已同步。

验收结束后停止此次启动的前端与后端进程；工作树保留，等待用户决定合并或删除。
