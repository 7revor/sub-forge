# 本地一键启动与停止

macOS 在 Finder 双击 `start-local.command` 启动，双击 `stop-local.command` 停止。也可以在终端执行：

```bash
./scripts/start-local.command
./scripts/stop-local.command
```

脚本可以从任意工作目录运行；放在 git worktree 中时，仍启动仓库**主目录当前检出的代码**，不会切换分支。默认仅监听 `http://127.0.0.1:8080`。

- 启动：检查已有进程和端口，构建最新前端，后台启动服务，确认监听进程和健康检查成功后返回。关闭启动终端不影响服务运行。
- 停止：核对 PID、进程命令、工作目录和启动时间，发送 SIGTERM 等待最多 30 秒；正常停止超时不会强行杀进程。旧服务记录没有启动时间时，按命令与目录核对。
- 重复启动不会创建第二个实例；重复停止可安全执行。并发启动 / 停止使用文件锁串行处理，脚本退出即释放锁。PID 被复用或端口被其他程序占用时会明确报错，不停止无关进程。
- 停止保留数据库、密钥、日志和前端构建。启动失败会清理本次启动的后台进程并报告日志位置。

需要当前机器已安装 Git、Python 3、Node.js ≥ 22、pnpm 和 lsof，以及项目依赖。脚本不会下载依赖或浏览器工具；依赖缺失时按提示在主目录运行 `pnpm install --frozen-lockfile`。

## 数据与日志

如果仓库中存在 `.Codex/runtime/m1-stabilization/sub-forge.db`，默认继续使用该目录中的现有数据、密钥和服务记录，兼容此前启动的本地服务。否则使用 `.Codex/runtime/local-service/`。

目录中包含：

| 文件 | 用途 |
| --- | --- |
| `sub-forge.db`、`secret.key` | 数据库与加密密钥，备份时必须一起保存 |
| `service.json`、`service.pid` | 服务状态与进程信息，正常停止后移除 PID 文件 |
| `service.lock` | 启停操作锁，文件留在磁盘不代表锁仍被持有 |
| `server.log` | 追加写入的服务日志 |
| `web-local/` | 最新前端构建，保留旧哈希资源供已打开的页面使用 |

本地脚本固定使用数据库旁的 `secret.key`，不使用终端中的 `SUBFORGE_SECRET`；现有数据库缺少密钥时拒绝启动，不生成替代密钥。当前账号与密码继续使用；全新目录首次使用时，可按 [服务端说明](../packages/server/README.md#本地) 设置初始管理员，脚本不会重置已有用户。

需要隔离实例或换端口时，启动与停止均传入同一个数据目录：

```bash
SUBFORGE_LOCAL_RUNTIME_DIR=/tmp/sub-forge-demo SUBFORGE_LOCAL_PORT=18080 ./scripts/start-local.command
SUBFORGE_LOCAL_RUNTIME_DIR=/tmp/sub-forge-demo ./scripts/stop-local.command
```

## 验证脚本

```bash
python3 scripts/test-local-service.py
```

使用带空格的临时目录及随机空闲端口，验证启动 / 停止幂等、并发启动、PID 身份保护、端口占用、缺失密钥、构建失败与服务启动失败。临时服务在验证后停止，不读取已有用户数据库。
