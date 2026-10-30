# 唯一订阅链接验收

日期：2026-10-30。分支：`codex/single-subscription-link`，基于 `65fb46d`。

## 结果与升级规则

- 保存订阅与生成令牌在同一个数据库事务中完成。每个订阅一个令牌，令牌全局唯一；普通保存不变，复制配置得到不同令牌。
- 页面只显示一条无参数链接，支持复制及直接打开，移除按设备新增、设备备注、单独 Stash 链接和多链接管理入口。
- v22 升级保留每个订阅最早的链接（同一时间按原列表的 token_hash 排序），无链接则补生成，其余旧链接及对应资源地址失效。此开发过程没有升级实际业务数据库。
- 兼容原 GET/POST tokens 接口：GET 返回单项列表，POST 幂等返回已有链接；重置仍是原子替换。单独删除唯一链接返回 409，删除整个订阅会清除链接。
- 同一地址依照 User-Agent 返回 Mihomo 或 Stash 内容；未知 UA 与浏览器默认 Mihomo。显式参数仍可覆盖以兼容旧地址。
- 主订阅响应使用 `text/plain; charset=utf-8` 和 `inline`，浏览器直接显示 YAML；保留文件名、流量和更新间隔，增加 `Vary: User-Agent` 和 `nosniff`，保持 `no-store`。

## 请求头核对

已核对公开的一手资料：

| 客户端 | 证据与处理 |
| --- | --- |
| Mihomo | [官方全局配置](https://wiki.metacubex.one/config/general/)说明默认全局 UA 为 `clash.meta`；归入 Mihomo。 |
| Clash Verge Rev | [官方源码 network.rs](https://github.com/clash-verge-rev/clash-verge-rev/blob/44d50eb67d86d80015b0b1664f33ed88880f19ee/src-tauri/src/utils/network.rs)使用 `clash-verge/v<版本>`；UA 未给出平台时保留平台未知，不猜测操作系统。 |
| FlClash | [官方源码 package.dart](https://github.com/chen08209/FlClash/blob/7fd417fb9a9a277c6a9339a8ac87f907df7c25f7/lib/common/package.dart)拼接应用名称与版本、`clash-verge`、`Platform/<操作系统>`；使用平台标识选择输出。 |
| Clash Meta for Android | 保留已有的 `ClashMetaForAndroid/…` 识别与 Android 平台规则；项目现有测试已有此样例。本次未运行真实客户端抓取请求头。 |
| Stash | 保留现有 `Stash/…` 样例测试及默认 iOS 策略，支持明确的 macOS / StashMac 标识；tvOS 采用与 iOS 一样的受限平台输出。[官方规则文档](https://stash.wiki/rules/rule-types)说明 iOS/tvOS 的进程规则限制。未从官方资料确认完整且稳定的订阅 UA 格式，也未真机抓包；测试里的版本号与 CFNetwork 字符串是兼容性样例。 |

修正不能仅凭 `Darwin` 判定 macOS 的问题，因为它也出现在 iOS 请求头中。UA 不提供足够信息时无法可靠区分系统或应用版本；不依靠版本号猜测系统。Surge 仍明确返回 501，本次没有实现 Surge、Loon、sing-box 等其他输出格式，也不把回归测试当作这些客户端的真机验收。

## 自动验证

- `pnpm typecheck`：通过。
- `pnpm test`：核心 277、服务端 462、前端 351 项通过，共 1090 项；既有条件测试跳过 46 项，未计为通过。真实 Mihomo 内核/运行时等条件测试未执行。
- `pnpm --filter @sub-forge/web build`：通过；保留已有的大产物体积提示。
- 新增回归覆盖：保存即生成、重复/并发获取、编辑保持链接、复制配置和用户隔离、删除订阅撤销链接、同一 URL 的 UA 分流、令牌冲突保护、保存及重置失败的事务回滚、旧库多链接收敛/无链接补齐/重启幂等、数据库唯一约束。
- 已有统一弹窗架构与生命周期单测随前端全量测试通过；本次仅移除订阅链接管理弹窗调用，未修改弹窗运行时或其他弹窗行为。

## 内置浏览器验收

启动 `pnpm exec tsx test/manual-single-subscription-server.ts`（目录 `packages/server`），使用内存数据库、虚构节点和测试账号，地址 `http://127.0.0.1:5239`。未安装、启动或调用独立 Playwright / Chromium。

1. 登录后新建订阅，加入「验收节点」，保存后自动出现一条订阅地址，顶部与概览复制入口均可用。
2. 概览无新增链接、设备备注、单独 Stash 链接或删除单条链接入口。[界面截图](subscription.png)。
3. 点击复制后，回粘到未保存的名称草稿，内容与订阅地址完全相同；随后放弃草稿。内置浏览器的剪贴板读取接口返回空，使用真实回粘完成验证。
4. 浏览器打开该地址，页面直接显示 `proxies`、`proxy-providers`、`proxy-groups` 和 `rules` YAML，而非触发下载。[直开截图](browser-mihomo.png)。
5. 修改名称再保存，地址保持不变；复制配置后新地址不同，刷新页面后仍保持副本地址。
6. 浏览器控制台无错误。不同 UA 的客户端输出由真实服务端请求测试覆盖，未使用真实客户端导入。

验收结束后关闭本次浏览器标签并停止临时服务，检查 5239 端口不再监听。工作树保留，等待用户决定是否合并或删除。
