# 自动规则格式合并 main 后复验

日期：2026-10-29。验证代码：`main@2b5a8f5`。

## 合并

- 合并前 main 为 `b93ebc1`，功能提交为 `febdee1`。
- 在 `codex/rule-auto-format` worktree 合入 main，解决 Rulesets 与 CustomRepoDialog 两处冲突，保留主干三按钮来源布局、保存成功通知和错误提示组件，同时保留自动格式识别与移除格式选择。
- 整合提交 `2b5a8f5`，随后 main 快进到该提交。

## main 上重新运行

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 720 项通过、30 项跳过；core 176/23、server 295/5、web 249/2 |
| `pnpm typecheck` | 通过 |
| `pnpm --filter @sub-forge/web build` | 通过；保留已有大包提示 |
| `git diff --check` | 通过 |
| 实际订阅与 LIST 下载 | 单个 text/classical provider，地址为 .list；正文三行与浏览器合并预览完全一致 |

跳过项包含需要外部运行环境的既有集成测试，不将跳过项目记为通过。此次没有进行 mihomo/Surge 客户端运行时验收。

## 内置浏览器

使用 main 的最新构建，在 `http://127.0.0.1:18439` 启动隔离应用（内存数据库、虚构测试账号和固定 YAML 上游响应）。后端和静态资源均来自 main，未连接生产数据。

- 展开 TXT 地址来源，无输入格式与 behavior 选择，按正文识别 YAML；预览为两行 classical，下载策略为 yaml/classical 原格式引用：[截图](original.png)。
- 保留主干关联仓库、远程、本地三个并列入口。
- 添加本地来源并保存，统一保存成功通知出现；合并预览变为三行 classical LIST：[截图](merged.png)。
- 通过真实 HTTP 订阅与规则资源接口读取该测试配置，断言 .list 路径、text/classical 元数据和完整正文均正确。
- 停用本地来源并保存后，恢复原格式输出。
- 自定义仓库弹窗不再显示格式选择，保留 list/txt 包含模式：[截图](repository.png)。

## 清理

临时浏览器标签已关闭。临时服务 PID 18034 已停止，18439 端口已释放。保留 worktree；未推送、部署或修改生产数据。本记录与截图是验证后的文档提交，不改变已验证代码。
