# 本地开发服务一键启动与停止

启动和停止入口分别为无扩展名的可执行脚本 `start`、`stop`。在仓库目录执行：

```bash
./scripts/start
./scripts/stop
```

脚本可以从任意工作目录运行，启动**脚本所在工作树的源码**，不会切换分支。主目录中的脚本运行主目录代码；独立 worktree 中的脚本运行该 worktree 的代码。

| 服务 | 默认地址 | 开发行为 |
| --- | --- | --- |
| 前端 | `http://127.0.0.1:5173` | Vite 开发服务，保存前端源码后热更新 |
| 后端 | `http://127.0.0.1:8080` | Node watch + tsx 直接运行 TypeScript，后端及导入的核心模块变化后自动重启 |

浏览器访问前端地址；Vite 将 `/api`、`/sub`、`/p`、`/r` 和 `/healthz` 代理到后端。开发时生成的订阅链接也使用前端地址。两个服务仅监听 `127.0.0.1`。

- 启动：检查已有进程及两个端口，后台启动开发服务，确认前后端监听、Vite 客户端和 API 代理健康后返回。**不执行 `vite build` / `pnpm build`，不读取静态打包产物**，并清除继承环境中的 `WEB_DIR`。关闭启动终端不影响服务运行。
- 停止：核对 PID、进程命令、工作目录和启动时间，通知管理进程停止 Vite 与后端 watcher，并等待整个进程组退出，最多 30 秒；正常停止超时不会强行杀进程。旧单进程服务记录仍可停止；旧记录没有启动时间时，按命令与目录核对。
- 重复启动不会创建第二个实例；重复停止可安全执行。并发启动 / 停止使用文件锁串行处理，脚本退出即释放锁。PID 被复用或端口被其他程序占用时会明确报错，不停止无关进程。
- 停止保留数据库、密钥与日志。启动失败会清理本次启动的全部开发进程并报告日志位置。

需要当前机器已安装 Git、Python 3、Node.js ≥ 22、lsof 及项目依赖；安装依赖时使用 pnpm。脚本不会下载依赖或浏览器工具；依赖缺失时按提示在对应工作树运行 `pnpm install --frozen-lockfile`。

## 数据与日志

如果仓库中存在 `.Codex/runtime/m1-stabilization/sub-forge.db`，默认继续使用该目录中的现有数据、密钥和服务记录，兼容此前启动的本地服务。否则使用 `.Codex/runtime/local-service/`。

目录中包含：

| 文件 | 用途 |
| --- | --- |
| `sub-forge.db`、`secret.key` | 数据库与加密密钥，备份时必须一起保存 |
| `service.json`、`service.pid` | 开发服务状态、管理进程与进程组信息，正常停止后移除 PID 文件 |
| `service.lock` | 启停操作锁，文件留在磁盘不代表锁仍被持有 |
| `server.log` | 前后端开发服务追加写入的日志 |

已有 `web-local/` 等历史打包目录不删除，开发服务不使用它们。各工作树默认共用上述本地数据；同时运行不同工作树时须分别指定数据目录和端口。

本地脚本固定使用数据库旁的 `secret.key`，不使用终端中的 `SUBFORGE_SECRET`；现有数据库缺少密钥时拒绝启动，不生成替代密钥。当前账号与密码继续使用；全新目录可在首次启动时设置 `SUBFORGE_ADMIN_USERNAME` 和 `SUBFORGE_ADMIN_PASSWORD`，脚本不会重置已有用户，详见 [服务端说明](../packages/server/README.md#本地)。

需要隔离实例或换端口时，启动与停止均传入同一个数据目录：

```bash
SUBFORGE_LOCAL_RUNTIME_DIR=/tmp/sub-forge-demo SUBFORGE_LOCAL_PORT=18080 SUBFORGE_LOCAL_WEB_PORT=15173 ./scripts/start
SUBFORGE_LOCAL_RUNTIME_DIR=/tmp/sub-forge-demo ./scripts/stop
```

## 验证脚本

```bash
python3 scripts/test-local-service.py
```

使用带空格的临时目录及随机空闲端口，验证 Vite 开发资源、登录代理、后端与核心模块自动重启、不调用打包命令、启动 / 停止幂等、并发启动、进程身份保护、端口占用、缺失密钥、旧服务兼容停止与启动失败清理。临时服务在验证后停止，不读取已有用户数据库。
