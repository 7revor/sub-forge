# 节点来源、代理链卡片与 Provider 独立组验收

日期：2026-10-30。基线：0b7200c，分支：codex/profile-source-cards。

## 实现范围

- 节点来源、代理链统一复用 RoutingCard，采用相同图标、间距、边框、字号和操作按钮，支持排序。
- Provider 行可直接追加 SELECT 独立组，动态引用来源；重复名称自动编号。绑定模板和独立模式均可创建、编辑、删除并保存。
- 绑定独立组持久化为 routing.extraGroups，模板更新、解绑和切换模板可保留；规则/代理链可引用，冲突、循环和非法来源拒绝保存。
- 代理链列表、流量路径、成员前置摘要去掉来源前缀。全部与正则范围读取真实节点名称；加载与错误状态明确。

## 非浏览器检查

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | passed，core/server/web 全部通过 |
| core 全量 | passed：284，skipped：39 |
| server 全量 | passed：469，skipped：5 |
| web 全量（含 architecture 与 controller 生命周期） | passed：356，skipped：2 |
| web build | passed；保留既有大包体积提示 |
| git diff --check | passed |

新增回归覆盖：两种模式的快捷创建、避重名、输入草稿不变、删除引用清理、切换模板映射；绑定独立组存储、Mihomo/Stash 导出、模板更新/解除绑定/重新绑定、重复组 ID/名称、畸形成员、外部来源和循环拒绝。

## 内置浏览器

仅使用 Codex @Browser。运行 manual-member-chain.ts 内存数据库、虚构账号和本地节点；禁止上游网络拉取。域名为本轮专用 profile-source-cards.localhost，端口 18951/18952。

| 场景 | 结果与证据 |
| --- | --- |
| 来源、代理链、策略组列表风格 | passed；cards-desktop.png、bound-groups.png |
| 绑定 Provider 连续快捷添加 | passed；直接出现中转机场和中转机场 2，各自有独立编辑/删除操作 |
| 模板组保持锁定、独立组可编辑 | passed；独立组改为中转独立组，保存重开仍保留 |
| 取消改名不提交、重开从原数据初始化 | passed；临时名称未出现在页面 |
| 模板更新后保留独立组 | passed；将模板组改为“🚀 科学上网新版”并保存，订阅模板组更新，独立组和代理链保留 |
| 删除独立组并保存 | passed；中转机场 2 删除，其他组保留 |
| 独立模式快捷添加并保存重开 | passed；中转机场组保留 |
| 单节点路径 | passed；🇭🇰 香港 IPLC → 🇺🇸 GCP [01]，不带来源 |
| 策略组前置 + 全部 Inline 落地 | passed；中转机场 → 🇺🇸 GCP [01]、🇸🇬 新加坡，保存重开仍一致 |
| 默认全部及正则动态名称 | passed；全部范围直接显示节点名，正则从日本改为香港后路径随之更新 |
| 组内成员前置摘要 | passed；整集前置只显示策略组名 |
| 390px 窄屏 | passed；cards-mobile.png、chains-mobile.png；文档 scrollWidth=innerWidth=390，卡片宽320/内容滚动宽318，无横向溢出 |
| 控制台错误 | passed；本轮产品页面 error 日志为空 |

## 弹窗生命周期

验收页 test/dialog-exit.html 在 StrictMode 下运行，新增绑定独立组 fixture。原始记录：lifecycle.txt。

- passed：取消、关闭按钮、Escape、遮罩关闭；所有关闭后 Promise 各结算一次。
- passed：固定视口下关闭到卸载期间标题、正文、输入值与布局高度保持；独立组 120–121 帧、688px，代理链 121 帧、680px。
- passed：无动画保存返回 confirmed；独立组草稿返回结果完整。
- passed：保存失败展示错误并保留输入，重试返回 confirmed。
- passed：子弹窗取消不改父草稿，路由离开返回 cancelled/navigation。
- 一次 Escape 采样期间误对仍在退场的验收标签应用了视口覆盖，导致高度从688变800，原始失败记录保留；恢复视口后复验120帧通过。这次环境干扰采样不记为产品通过。窄屏最终通过同一内置浏览器的标签页 CDP 定向验证，完成后恢复视口。

未覆盖浏览器中的超大真实订阅源或真实网络请求；本轮采用隔离数据，无真实用户数据改写。

## 清理

验收结束关闭本轮两个浏览器标签，停止 API 与 Vite 临时服务，确认18951/18952无监听。工作树与提交保留，等待用户决定合并。
