# 访问日志 IP 与部署透传验收

日期：2026-10-30。工作树：`codex/access-log-client-ip`。仅虚构数据和内存 / 临时数据库；未修改现有实例、真实数据库或生产配置。

## 实现

- Node TCP 对端作为默认 IP；显式可信代理 IP / CIDR 才启用 X-Forwarded-For，从右向左在非可信节点处停止。支持 IPv4、IPv6 及 IPv4 映射形式。
- 日志保存客户端 IP、连接对端与来源；SQLite v25 保留旧记录且不补猜地址；用户隔离、下载入口和 30 天保留策略不变。
- 首页增加 IP 列与来源说明，连接来源可悬停查看；历史为空显示“未记录”。Docker / Nginx / CDN / PROXY protocol 的边界与上线核验见 [部署说明](../../../docs/20-deployment-client-ip.md)。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @sub-forge/server test` | 578 通过、5 原有跳过；含纯解析测试、真实 HTTP 连接、默认忽略伪造头、可信透传、IPv6、多级链、HEAD、失败请求、v23/v24 迁移与重启保留 |
| `pnpm --filter @sub-forge/web test` | 365 通过、2 原有跳过 |
| `pnpm typecheck` | 三个包通过 |
| `pnpm --filter @sub-forge/web build` | 通过；保留既有大包体积提示 |
| 依赖 | frozen-lockfile 安装，锁文件未改变；Playwright 仅为 Vitest 可选 peer 声明，没有安装或调用独立浏览器依赖 |

初次回归发现旧迁移测试固定期待 v24，本次将预期同步为 v25 后全量重跑通过。

## 内置浏览器

使用 `packages/server/test/manual-access-ip-server.ts` 在 `127.0.0.1:18743` 启动隔离服务。仅信任回环代理和虚构内部代理，通过实际 Node HTTP 连接产生 IPv4 / IPv6 透传、直连、伪造链与非法头回退记录；旧日志使用无 IP 的样例。

- 登录后首页显示 6 条记录，IPv4 / IPv6、来源文字、连接对端及旧记录“未记录”均正常，见 [桌面截图](desktop.png)。
- 多级样例 `192.0.2.66, 198.51.100.8, 10.2.0.2` 只记录 `198.51.100.8`，不接受最左侧伪造值。
- 390px 窄屏测得页面宽度 390px、表格容器 352px、表格 920px，横向滚动仅发生在表格容器；滚动到 `scrollLeft=420` 后可查看右侧 IP / 客户端列，见 [窄屏截图](mobile.png)。
- 切换“订阅”筛选显示“该类型暂无访问记录”，七列空态和 0 条分页正常。
- 已恢复临时视口设置；测试结束停止隔离服务。

## 未执行与限制

- 外部 Claude Design 画布显示“Sign in to view this page”，见 [登录限制](design-login.png)；已按 docs/13 登记待同步，不记为已修改。
- 未部署实际 Docker / Nginx / CDN；文档示例不能替代生产入口、NAT、CDN 网段及禁止绕行的实测。
- 未运行需要外部内核环境的既有跳过用例，不将跳过计为通过。
