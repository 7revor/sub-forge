# Cloudflare Tunnel 部署

用 Cloudflare Tunnel 隐藏后端入口：服务器上的 `cloudflared` 主动连接 Cloudflare，不需要开放入站端口。这是 [Nginx 部署](24-first-deployment.md)之外的另一种方式，两者任选其一。

```text
客户端 → HTTPS → Cloudflare → 加密隧道 → cloudflared → HTTP → sub-forge:8080
```

下文的 `your-name/sub-forge` 和 `sub.example.com` 都要换成实际值。

## 不需要什么

- **后端 HTTPS 和证书：** 证书由 Cloudflare 提供，`cloudflared` 到 Cloudflare 这段已加密。`cloudflared` 到应用走 Docker 内部网络的 HTTP，不经过公网。
- **Nginx：** 应用不发布端口，也不经过 Nginx。
- **入站端口：** 这个服务不需要防火墙放行任何入站端口。

`PUBLIC_URL` 仍然要写 `https://`，它决定订阅链接和 Secure Cookie。

## 1. 创建 Tunnel

域名需要托管在 Cloudflare 上。

1. 在 Cloudflare Zero Trust 控制台的 Tunnels 页面新建一个 `cloudflared` 类型的 Tunnel，复制令牌。
2. 添加公共主机名：
   - 主机名：`sub.example.com`
   - 服务类型：`HTTP`
   - 服务地址：`sub-forge:8080`

Cloudflare 会自动创建 DNS 记录。如果该主机名已有 DNS 记录，要先删除。

## 2. 发布镜像（开发机）

```bash
docker login
./scripts/docker-push your-name/sub-forge
```

## 3. 准备部署目录（服务器）

```bash
mkdir -p ~/sub-forge/data
cd ~/sub-forge
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/compose.tunnel.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/7revor/sub-forge/main/docker/.env.example -o .env
sudo chown 1000:1000 data
```

编辑 `.env`（含密码和令牌，不要提交到任何仓库）：

```ini
SUBFORGE_IMAGE=your-name/sub-forge:latest
PUBLIC_URL=https://sub.example.com
ALLOWED_ORIGINS=https://sub.example.com
CLOUDFLARE_TUNNEL_TOKEN=第1步复制的令牌
SUBFORGE_DATA_DIR=./data
SUBFORGE_ADMIN_USERNAME=admin
SUBFORGE_ADMIN_PASSWORD=请改成至少8位的强密码
TZ=Asia/Shanghai
```

`SUBFORGE_PORT` 和 `SUBFORGE_TRUSTED_PROXIES` 在这种部署里不生效。可信代理已固定为 `cloudflared` 的容器地址 `172.30.81.2`。如果 `172.30.81.0/24` 与服务器现有网络冲突，要同时修改 `compose.yaml` 里的网段、两个容器的固定地址和 `SUBFORGE_TRUSTED_PROXIES`。

## 4. 启动

以下 Compose 命令都在 `~/sub-forge` 目录执行。

```bash
docker compose up -d
```

`cloudflared` 会等应用健康后才启动，最多要等 30 秒左右。查看状态和日志：

```bash
docker compose ps
docker compose logs -f cloudflared
```

然后确认公网可以访问：

```bash
curl -i https://sub.example.com/healthz
```

## 5. 首次登录

1. 打开 `https://sub.example.com`，用管理员账号登录。
2. 确认能登录后，从 `.env` 删掉 `SUBFORGE_ADMIN_USERNAME` 和 `SUBFORGE_ADMIN_PASSWORD`。

## 6. 配置 Cloudflare 安全规则

`/subs` 和 `/resources` 由 Mihomo、Surge 等客户端访问，可能被 Bot Fight Mode 或 WAF 拦截。用实际客户端刷新一次订阅；如果被拦截，在 Cloudflare 的安全事件里找到对应规则并放行这两个路径。

## 7. 配置备份

和 Nginx 部署相同，见[配置备份](24-first-deployment.md#7-配置备份)。定时备份不经过 Cloudflare，不受下文超时限制。

## 上线检查

- [ ] 能通过 HTTPS 登录，并能正常保存数据
- [ ] 页面能实时刷新（SSE 正常）
- [ ] 实际客户端能拉取订阅
- [ ] 访问日志的“客户端 IP”是该设备的出口地址，悬停看到的“连接来源”是 `172.30.81.2`
- [ ] 请求带伪造的 `X-Forwarded-For: 198.51.100.66` 时，日志不会记录这个地址
- [ ] 服务器的 80、443 端口不再响应这个域名
- [ ] 第一份备份已成功上传

## 更新

先发布新镜像，并在系统页点一次立即备份，再到服务器的 `~/sub-forge` 目录执行：

```bash
docker compose pull
docker compose up -d
```

`cloudflared` 使用 `latest` 标签，会随这两条命令一起更新。数据库迁移和回退的说明见[更新](24-first-deployment.md#更新)。

## 从 Nginx 部署切换

1. 用第 3 步的地址下载新的 `compose.yaml`，覆盖原文件，并在 `.env` 里填写 `CLOUDFLARE_TUNNEL_TOKEN`。数据目录保持不变。
2. 在 Cloudflare 删除该域名原有的 DNS 记录，再按第 1 步添加公共主机名。
3. 执行 `docker compose up -d --remove-orphans`。
4. 确认服务正常后，从 Nginx 删除该域名的配置和 SNI 映射，再重载 Nginx。

## 已知限制

- **明文可见：** TLS 在 Cloudflare 终止，节点凭据、URL 里的订阅令牌和登录会话都会经过 Cloudflare。
- **出站仍暴露 IP：** 拉取订阅上游、Git 同步规则仓库和 WebDAV 备份都由后端直接发起，目标服务能看到服务器的真实 IP。后端目前没有出站代理配置。
- **DNS 历史和 SNI：** 如果这个域名曾经直接解析到服务器，历史记录可能暴露 IP。必要时换一个新子域名，并确认服务器不再响应它。
- **100 秒超时：** Cloudflare 大约等待 100 秒，超时返回 524。手动备份 `/api/system/backup/run` 和恢复 `/api/system/backup/restore` 都要等服务端处理完才返回，数据量大时可能超时。超时后请到系统页查看实际状态，不要立刻重复操作。
- **请求体上限：** 免费计划单次请求体上限为 100 MB，模板和节点 YAML 不会达到这个大小。
