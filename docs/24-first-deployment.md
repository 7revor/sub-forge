# 部署指引

Sub Forge 是一个 Docker 容器，前端、管理接口和订阅接口都走同一个端口。容器启动后开放端口就能访问，不需要其他组件。

访问使用明文 HTTP，登录密码和订阅链接都不加密。

下文的 `your-name/sub-forge` 要换成实际的镜像名。

## 发布镜像（开发机）

```bash
docker login
./scripts/docker-push your-name/sub-forge
```

脚本默认构建 `linux/amd64` 和 `linux/arm64`，推送时间戳和当前提交的短哈希两个标签，不再推送 `latest`。发布完成后脚本会输出镜像标签和可写入 `.env` 的 `SUBFORGE_IMAGE`，选项见[脚本说明](../scripts/README.md#发布-docker-镜像)。

## 启动（服务器）

服务器只需要 Docker 和 Compose 插件，不需要源码。

```bash
mkdir -p ~/sub-forge && cd ~/sub-forge
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/.env.example -o .env
```

编辑 `.env`，填写发布时输出的镜像和管理员密码（至少 8 位），然后启动：

```bash
docker compose up -d
```

打开 `http://服务器地址:8080` 登录。确认能登录后，可以从 `.env` 删掉管理员账号和密码，它们只在没有用户时使用。

不用 Compose 时，等价的命令是：

```bash
docker run -d --name sub-forge --restart unless-stopped -p 8080:8080 -v "$PWD/data":/data \
  -e SUBFORGE_ADMIN_USERNAME=admin -e SUBFORGE_ADMIN_PASSWORD='请改成强密码' \
  your-name/sub-forge:20261103130512
```

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBFORGE_IMAGE` | 无，必填 | 带标签的镜像，如 `your-name/sub-forge:20261103130512` |
| `SUBFORGE_ADMIN_USERNAME` / `SUBFORGE_ADMIN_PASSWORD` | 空 | 没有用户时用来创建管理员 |
| `SUBFORGE_PORT` | `8080` | 对外开放的端口 |
| `SUBFORGE_DATA_DIR` | `./data` | 数据库和密钥所在目录，不存在时自动创建，容器启动时自动授权 |
| `TZ` | `UTC` | 缓存周期按这个时区的 0 点对齐 |

## 访问行为

- **订阅链接：** 按当前访问的地址生成。用哪个地址打开页面，复制到的链接就是哪个地址。
- **访问日志 IP：** 记录 TCP 连接来源。Docker Desktop 或部分网络模式下，这里可能是网关地址。
- **写操作：** 只接受同源请求。

## 备份

在系统页的「数据库备份」里配置 WebDAV 地址、备份口令、间隔和保留份数，详情见[数据库备份](22-database-backup.md)。

- **备份口令要单独保管：** 丢失后备份无法解密，也无法找回。
- **不要删除数据目录：** 数据库和主密钥 `secret.key` 都在里面。

## 更新

先发布新镜像，在系统页点一次立即备份，再把服务器 `~/sub-forge/.env` 的 `SUBFORGE_IMAGE` 改成新标签，然后执行：

```bash
docker compose up -d
```

- **数据：** 数据目录和 `.env` 在容器之外，更新时保留。
- **数据库结构：** 新版本启动时自动迁移。
- **回退：** 把 `SUBFORGE_IMAGE` 改成旧标签。这不会回退数据库结构，需要用更新前的备份恢复数据，见[恢复流程](22-database-backup.md#恢复流程)。

## 从旧部署迁移

2026-11-03 之前的 `PUBLIC_URL`、`ALLOWED_ORIGINS`、`SUBFORGE_TRUSTED_PROXIES`、`SUBFORGE_BIND` 已经移除。按「启动」重新下载 `compose.yaml`，并把这些变量从 `.env` 删掉；数据目录不用动。

数据还在命名卷 `docker_sub-forge-data` 中时，先停止旧容器，再把数据复制到新目录：

```bash
docker run --rm -v docker_sub-forge-data:/from:ro -v "$PWD/data":/to alpine sh -c 'cp -a /from/. /to/'
```
