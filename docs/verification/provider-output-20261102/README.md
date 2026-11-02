# 节点来源输出设置验收

日期：2026-11-02。分支：`codex/provider-output-fix`，基于 `a04713c`。

## 行为

Surge、Loon、Stash 与 Mihomo 一样遵循来源的引用 / 展开设置。引用分别生成 Surge `policy-path`、Loon `[Remote Proxy]`、Stash `proxy-providers`；展开保留主配置中的节点。远程正文由本服务执行来源处理、成员筛选和客户端转换，不直接暴露上游地址。

筛选、多个来源、精确节点引用、重名、代理链及客户端能力限制见[转换说明](../../19-client-conversion.md#2026-11-02遵循节点来源输出设置)。无法保留语义的代理链明确报错，不自动内联。空组使用 REJECT，空原始资源返回 503，筛空的派生资源失效。包含远程节点的草稿不能下载，保存后通过正式订阅链接获取。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `SURGE_BIN=/Applications/Surge.app/Contents/Applications/surge-cli pnpm -r test` | core 741、server 656、web 351 项通过，合计 1748 项；46 项按环境条件跳过 |
| 补充空原始资源接口用例后，`pnpm --filter @sub-forge/server exec vitest run test/remote-provider-subscription.test.ts` | 15 项通过，较全量检查新增 3 项 |
| `pnpm -r typecheck` | 通过 |
| `pnpm --filter @sub-forge/web build` | 通过；保留既有大包体积提示 |
| `git diff --check` | 通过 |

核心新增用例覆盖引用 / 展开混用、多个来源、all 范围、包含 / 排除 / 类型筛选、稳定地址刷新、重名、精确引用、空集合、前置引用、Stash 同集代理链及不支持场景、测速参数。服务端用例覆盖主订阅、原生远程正文、来源流水线、HEAD、流量头、鉴权与撤销、切换展开使旧资源失效、草稿导出限制和旧缓存回退保护。

Surge 官方 CLI 对测试生成的主配置和本地远程资源执行离线语法检查通过。没有在真实 Surge、Loon、Stash 客户端中执行导入、远程拉取或代理连接。

## 内置浏览器验收

只使用 Codex 内置浏览器。服务使用内存数据库和固定虚构上游；没有修改真实配置、访问真实上游或使用真实节点凭据。复现入口：在 server 包目录运行 `pnpm exec tsx test/manual-remote-provider-server.ts`，前端需先构建。

- 引用模式：四端主配置均不内联节点，使用各自的远程入口；下载禁用并说明使用正式订阅链接。Surge / Stash 无错误或告警；Loon 仅保留既有规则优先级提示。
- 切换展开并保存：Surge、Stash、Loon 均内联两个虚构节点，远程入口消失，下载恢复可用。
- 再次切换引用并保存：远程入口恢复，下载重新禁用，报告显示“生成成功”。
- 已修正预览页旧的“强制内联”提示。

截图：[Mihomo 引用](mihomo-provider.png)、[Surge 引用](surge-provider.png)、[Stash 引用](stash-provider.png)、[Loon 引用](loon-provider.png)、[Loon 展开](loon-inline.png)。截图均为虚构验收数据。

验收结束后已停止临时服务，并确认 5248 端口无监听、验收脚本无残留进程；未停止用户原有服务。

## 实际配置隔离复算

通过只读数据库一致性副本和已有节点快照复算“公司拼车”，未请求实际上游、未修改运行中数据库。Mihomo、Surge、Loon、Stash 均为 0 个内联节点、90 个远程节点，原生远程入口存在，渲染错误数为 0。临时数据库副本已清理。

该结果只证明现有快照下的服务端生成行为，不代表最新上游状态、生产部署或真实客户端连接成功。本次未合并、推送或部署。
