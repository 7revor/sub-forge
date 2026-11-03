# 初次部署指引

从零部署一个新实例的完整步骤：开发机把镜像发布到 Docker Hub，服务器用 Docker Compose 拉取运行，不需要源码和 Git；宿主机 Nginx 负责 HTTPS。其他拓扑（Nginx 在容器里、CDN、多级代理、`docker run`）和可信代理的解析规则见 [部署与访问日志 IP](20-deployment-client-ip.md)。需要隐藏后端入口时，改用 [Cloudflare Tunnel 部署](25-cloudflare-tunnel.md)。

下文的 `your-name/sub-forge` 和 `sub.example.com` 都要换成实际值。

## 准备工作

- **开发机：** 仓库源码、Docker（含 Buildx），以及一个 Docker Hub 账号。
- **服务器：** 装好 Docker（含 Compose 插件）和 Nginx。
- **域名：** 一个解析到该服务器的域名和 TLS 证书。应用必须部署在域名根路径，不支持子路径。

## 1. 发布镜像（开发机）

在仓库根目录执行：

```bash
docker login
./scripts/docker-push your-name/sub-forge
```

脚本默认构建 `linux/amd64` 和 `linux/arm64`，推送 `latest` 和当前提交的短哈希两个标签。工作树有未提交改动时会拒绝发布。第二个参数可以把 `latest` 换成别的标签，其他选项见[脚本说明](../scripts/README.md#发布-docker-镜像)。

## 2. 准备部署目录（服务器）

```bash
mkdir -p ~/sub-forge/data
cd ~/sub-forge
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/.env.example -o .env
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/nginx.conf.example -o nginx.conf.example
sudo chown 1000:1000 data
```

容器以 UID 1000 运行，`data` 目录必须提前创建并授权。否则 Docker 会以 root 身份创建目录，应用无法写入。

编辑 `.env`（含密码，不要提交到任何仓库）：

```ini
SUBFORGE_IMAGE=your-name/sub-forge:latest
PUBLIC_URL=https://sub.example.com
ALLOWED_ORIGINS=https://sub.example.com
SUBFORGE_PORT=8080
SUBFORGE_DATA_DIR=./data
SUBFORGE_TRUSTED_PROXIES=
SUBFORGE_ADMIN_USERNAME=admin
SUBFORGE_ADMIN_PASSWORD=请改成至少8位的强密码
TZ=Asia/Shanghai
```

| 变量 | 说明 |
| --- | --- |
| `SUBFORGE_IMAGE` | 第 1 步发布的镜像。可以写短哈希标签来固定版本 |
| `PUBLIC_URL` | 对外 HTTPS 地址，决定订阅链接和 Secure Cookie |
| `ALLOWED_ORIGINS` | 不带路径，通常与 `PUBLIC_URL` 相同。没配时 Compose 拒绝启动；填错时登录和所有写操作都会返回“跨站请求被拒绝” |
| `SUBFORGE_DATA_DIR` | 数据库和密钥在宿主机上的目录，默认 `./data`。改到其他路径时，同样要提前创建并授权给 UID 1000 |
| `SUBFORGE_ADMIN_PASSWORD` | 首次启动必填，至少 8 位。示例文件里用户名已是 `admin`、密码为空，直接启动会报“请通过 SUBFORGE_ADMIN_PASSWORD 提供至少 8 位的密码”并退出 |
| `SUBFORGE_TRUSTED_PROXIES` | 先留空，[第 6 步](#6-配置真实-ip)再填 |
| `TZ` | 缓存周期按这个时区的 0 点对齐，默认 UTC |

## 3. 启动

以下 Compose 命令都在 `~/sub-forge` 目录执行。

```bash
docker compose up -d
```

确认服务正常：

```bash
curl -i http://127.0.0.1:8080/healthz
```

如果起不来，查看日志：

```bash
docker compose logs -f sub-forge
```

应用只绑定 `127.0.0.1:8080`，公网无法直接访问。

## 4. 配置 Nginx

```bash
sudo cp nginx.conf.example /etc/nginx/conf.d/sub-forge.conf
```

把里面的域名和证书路径改成实际值。如果改过 `SUBFORGE_PORT`，`upstream` 的端口也要一起改。然后检查并重载：

```bash
sudo nginx -t
sudo nginx -s reload
```

[示例配置](../docker/nginx.conf.example)已经处理了 `/api/events` 的 SSE 缓冲、备份恢复的长超时和 `X-Forwarded-For` 覆盖，不要删掉。如果 Nginx 也跑在容器里，它访问不到宿主机回环地址，改用[推荐拓扑](20-deployment-client-ip.md#推荐拓扑nginx-与应用在同一-docker-网络)。

## 5. 首次登录

1. 打开 `https://sub.example.com`，用管理员账号登录。
2. 确认能登录后，从 `.env` 删掉 `SUBFORGE_ADMIN_USERNAME` 和 `SUBFORGE_ADMIN_PASSWORD`。它们只在没有用户时才会用到。

## 6. 配置真实 IP

1. 从另一台设备经 HTTPS 域名下载一次自己的订阅。
2. 在访问日志里，把鼠标悬停在 IP 单元格上，读取“连接来源”（`peerIp`），这就是应用看到的 Nginx 地址。
3. 确认它确实是这台 Nginx 后，把这个精确 IP 填入 `SUBFORGE_TRUSTED_PROXIES`，然后重建容器：

   ```bash
   docker compose up -d
   ```

4. 再下载一次，确认“客户端 IP”变成了该设备的出口地址。

不要填 `*`、`/0` 或整个内网网段：前两者启动时直接报错，后者会扩大信任范围。

## 7. 配置备份

在系统页的「数据库备份」里配置 WebDAV 地址、备份口令、间隔和保留份数，然后点一次立即备份确认可用。详情见[数据库备份](22-database-backup.md)。

- **备份口令要单独保管：** 丢失后备份无法解密，也无法找回。
- **不要删除数据目录：** 数据库和主密钥 `secret.key` 都在 `SUBFORGE_DATA_DIR` 里。

## 上线检查

- [ ] 能通过 HTTPS 登录，并能正常保存数据
- [ ] 页面能实时刷新（SSE 正常）
- [ ] 复制的订阅链接是正式域名，客户端能拉取
- [ ] 外部无法访问服务器的 8080 端口
- [ ] 请求带伪造的 `X-Forwarded-For: 198.51.100.66` 时，日志不会记录这个地址
- [ ] 第一份备份已成功上传

完整的网络链路核验项见[上线核验](20-deployment-client-ip.md#上线核验)。

## 更新

先在开发机发布新镜像：

```bash
./scripts/docker-push your-name/sub-forge
```

然后在系统页「数据库备份」点一次立即备份，再到服务器的 `~/sub-forge` 目录执行：

```bash
docker compose pull
docker compose up -d
```

确认新版本正常：

```bash
curl -i http://127.0.0.1:8080/healthz
docker compose logs --tail=50 sub-forge
```

- **数据和配置：** 数据目录和 `.env` 在容器之外，更新时保留，不需要重新填写。
- **数据库结构：** 新版本启动时自动迁移，不需要手动操作。
- **`compose.yaml`：** 不会随镜像更新。如果新版本改了它，按第 2 步重新下载。
- **回退：** 把 `SUBFORGE_IMAGE` 改成旧的短哈希标签即可换回旧镜像，但这不会回退数据库结构，旧程序不应继续使用已迁移的数据库。需要回退时，用更新前的备份恢复数据，详见[恢复流程](22-database-backup.md#恢复流程)。

可选：清理旧镜像。

```bash
docker image prune -f
```

## 从源码构建部署迁移

此前在仓库里用 `docker/compose.yaml` 构建部署的实例，数据在命名卷 `docker_sub-forge-data` 中，切换到数据目录前要先复制出来。

先在旧仓库目录停止旧容器：

```bash
docker compose -f docker/compose.yaml down
```

按第 2 步准备好 `~/sub-forge` 后，在该目录复制数据：

```bash
docker run --rm -v docker_sub-forge-data:/from:ro -v "$PWD/data":/to alpine sh -c 'cp -a /from/. /to/'
```

启动并确认数据和登录都正常后，再按需删除旧卷 `docker_sub-forge-data` 和旧仓库目录。
