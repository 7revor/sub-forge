# 初次部署指引

从零部署一个新实例的完整步骤：Docker Compose 跑单个应用容器，宿主机 Nginx 负责 HTTPS。其他拓扑（Nginx 在容器里、CDN、多级代理、`docker run`）和可信代理的解析规则见 [部署与访问日志 IP](20-deployment-client-ip.md)。

## 准备工作

- 一台装好 Docker（含 Compose 插件）和 Nginx 的服务器。
- 一个解析到该服务器的域名和 TLS 证书。应用必须部署在域名根路径，不支持子路径。

## 1. 拉代码，准备配置

仓库没有现成镜像，需要在服务器上从源码构建。

```bash
git clone https://github.com/7revor/sub-forge.git
cd sub-forge
cp docker/.env.example docker/.env
```

编辑 `docker/.env`（含密码，已被 Git 忽略，不要提交）：

```ini
PUBLIC_URL=https://sub.example.com
ALLOWED_ORIGINS=https://sub.example.com
SUBFORGE_PORT=8080
SUBFORGE_TRUSTED_PROXIES=
SUBFORGE_ADMIN_USERNAME=admin
SUBFORGE_ADMIN_PASSWORD=请改成至少8位的强密码
TZ=Asia/Shanghai
```

| 变量 | 说明 |
| --- | --- |
| `PUBLIC_URL` | 对外 HTTPS 地址，决定订阅链接和 Secure Cookie |
| `ALLOWED_ORIGINS` | 不带路径，通常与 `PUBLIC_URL` 相同。没配时 Compose 拒绝启动；填错时登录和所有写操作都会返回“跨站请求被拒绝” |
| `SUBFORGE_ADMIN_PASSWORD` | 首次启动必填，至少 8 位。示例文件里用户名已是 `admin`、密码为空，直接启动会报“请通过 SUBFORGE_ADMIN_PASSWORD 提供至少 8 位的密码”并退出 |
| `SUBFORGE_TRUSTED_PROXIES` | 先留空，[第 5 步](#5-配置真实-ip)再填 |
| `TZ` | 缓存周期按这个时区的 0 点对齐，默认 UTC |

## 2. 构建并启动

```bash
docker compose -f docker/compose.yaml up -d --build
```

确认服务正常：

```bash
curl -i http://127.0.0.1:8080/healthz
```

如果起不来，查看日志：

```bash
docker compose -f docker/compose.yaml logs -f sub-forge
```

应用只绑定 `127.0.0.1:8080`，公网无法直接访问。

## 3. 配置 Nginx

```bash
sudo cp docker/nginx.conf.example /etc/nginx/conf.d/sub-forge.conf
```

把里面的域名和证书路径改成实际值。如果改过 `SUBFORGE_PORT`，`upstream` 的端口也要一起改。然后检查并重载：

```bash
sudo nginx -t
sudo nginx -s reload
```

[示例配置](../docker/nginx.conf.example)已经处理了 `/api/events` 的 SSE 缓冲、备份恢复的长超时和 `X-Forwarded-For` 覆盖，不要删掉。如果 Nginx 也跑在容器里，它访问不到宿主机回环地址，改用[推荐拓扑](20-deployment-client-ip.md#推荐拓扑nginx-与应用在同一-docker-网络)。

## 4. 首次登录

1. 打开 `https://sub.example.com`，用管理员账号登录。
2. 确认能登录后，从 `docker/.env` 删掉 `SUBFORGE_ADMIN_USERNAME` 和 `SUBFORGE_ADMIN_PASSWORD`。它们只在没有用户时才会用到。

## 5. 配置真实 IP

1. 从另一台设备经 HTTPS 域名下载一次自己的订阅。
2. 在访问日志里，把鼠标悬停在 IP 单元格上，读取“连接来源”（`peerIp`），这就是应用看到的 Nginx 地址。
3. 确认它确实是这台 Nginx 后，把这个精确 IP 填入 `SUBFORGE_TRUSTED_PROXIES`，然后重建容器：

   ```bash
   docker compose -f docker/compose.yaml up -d
   ```

4. 再下载一次，确认“客户端 IP”变成了该设备的出口地址。

不要填 `*`、`/0` 或整个内网网段：前两者启动时直接报错，后者会扩大信任范围。

## 6. 配置备份

在系统页的「数据库备份」里配置 WebDAV 地址、备份口令、间隔和保留份数，然后点一次立即备份确认可用。详情见[数据库备份](22-database-backup.md)。

- **备份口令要单独保管：** 丢失后备份无法解密，也无法找回。
- **不要删除 `sub-forge-data` 卷：** 数据库和主密钥 `secret.key` 都在里面。

## 上线检查

- [ ] 能通过 HTTPS 登录，并能正常保存数据
- [ ] 页面能实时刷新（SSE 正常）
- [ ] 复制的订阅链接是正式域名，客户端能拉取
- [ ] 外部无法访问服务器的 8080 端口
- [ ] 请求带伪造的 `X-Forwarded-For: 198.51.100.66` 时，日志不会记录这个地址
- [ ] 第一份备份已成功上传

完整的网络链路核验项见[上线核验](20-deployment-client-ip.md#上线核验)。

## 更新

先在系统页「数据库备份」点一次立即备份，然后在仓库根目录执行：

```bash
git pull
docker compose -f docker/compose.yaml up -d --build
```

确认新版本正常：

```bash
curl -i http://127.0.0.1:8080/healthz
docker compose -f docker/compose.yaml logs --tail=50 sub-forge
```

- **数据和配置：** 数据在 `sub-forge-data` 卷中，更新时保留。`docker/.env` 不受 `git pull` 影响，不需要重新填写。
- **数据库结构：** 新版本启动时自动迁移，不需要手动操作。
- **回退：** 切回旧代码不会回退数据库结构，旧程序不应继续使用已迁移的数据库。需要回退时，用更新前的备份恢复数据，详见[恢复流程](22-database-backup.md#恢复流程)。

可选：清理构建留下的旧镜像层。

```bash
docker image prune -f
```
