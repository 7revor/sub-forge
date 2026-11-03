# 经独立 Cloudflare Tunnel 访问

用单独运行的 Cloudflare Tunnel 隐藏后端入口。`cloudflared` 由你自行部署和维护，不在本项目的 Compose 中；Sub Forge 只把端口绑定到内网 IP，由 Tunnel 经内网访问。这是 [Nginx 部署](24-first-deployment.md)之外的另一种接入方式，两者任选其一。

```text
客户端 → HTTPS → Cloudflare → 加密隧道 → cloudflared → 内网 HTTP → 服务器内网 IP:8080 → sub-forge
```

下文的 `sub.example.com` 和 `10.0.0.5` 都要换成实际值。

## 不需要什么

- **后端 HTTPS 和证书：** 证书由 Cloudflare 提供，`cloudflared` 到 Cloudflare 这段已加密。
- **Nginx：** 请求不经过 Nginx。
- **公网入站端口：** 这个服务不需要对公网开放任何端口。

`PUBLIC_URL` 仍然要写 `https://`，它决定订阅链接和 Secure Cookie。

内网这段是明文 HTTP。走 WireGuard、Tailscale 或可信内网都可以；如果是不可信的网络，要先加一层加密。

## 1. 部署 Sub Forge

按[初次部署指引](24-first-deployment.md)的第 1 到 3 步操作，`.env` 里这样写：

```ini
PUBLIC_URL=https://sub.example.com
ALLOWED_ORIGINS=https://sub.example.com
SUBFORGE_BIND=10.0.0.5
SUBFORGE_PORT=8080
SUBFORGE_TRUSTED_PROXIES=
```

`SUBFORGE_BIND` 填服务器的内网 IP，不要写 `0.0.0.0`。还要限制只有 Tunnel 所在的机器能访问这个端口。Docker 发布的端口通常会绕过 `ufw`，不能只靠 `ufw` 规则。

Tunnel 和 Sub Forge 在同一台机器时，同样按内网 IP 配置。`cloudflared` 容器访问不到宿主机的 `127.0.0.1`。

## 2. 配置 Tunnel

在 Tunnel 的已发布应用里添加路由：

| 字段 | 值 |
| --- | --- |
| 主机名 | `sub.example.com` |
| 路径 | 留空 |
| Service URL | `http://10.0.0.5:8080` |

Cloudflare 会自动创建 DNS 记录。如果该主机名已有 DNS 记录，要先删除。

Service URL 必须是 `cloudflared` 容器能访问到的地址，可以在它所在的网络里确认。

## 3. 配置真实 IP

1. 从另一台设备下载一次自己的订阅。
2. 在访问日志里，把鼠标悬停在 IP 单元格上，读取“连接来源”（`peerIp`），这就是应用看到的 Tunnel 地址。
3. 确认后把这个精确 IP 填入 `SUBFORGE_TRUSTED_PROXIES`，然后重建容器：

   ```bash
   docker compose up -d
   ```

4. 再下载一次，确认“客户端 IP”变成了该设备的出口地址。

## 4. 配置 Cloudflare 安全规则

`/subs` 和 `/resources` 由 Mihomo、Surge 等客户端访问，可能被 Bot Fight Mode 或 WAF 拦截。用实际客户端刷新一次订阅；如果被拦截，在 Cloudflare 的安全事件里找到对应规则并放行这两个路径。

## CDN 缓存

经 Tunnel 的公共主机名默认走 Cloudflare 代理，前端静态资源可以使用 CDN 缓存，不需要额外配置：

| 路径 | 应用返回的缓存头 | 预期结果 |
| --- | --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` | 缓存。文件名带内容哈希，发布新版本后自然换新地址 |
| 页面（`index.html`） | `no-cache` | 不缓存，发布后立刻生效 |
| `/subs/*`、`/resources/*`、`/auth/*` | `no-store` | 不缓存 |

确认缓存是否生效（文件名从页面源码中取，第二次请求应该显示 `HIT`）：

```bash
curl -sI https://sub.example.com/assets/文件名.js | grep -i cf-cache-status
```

不要添加“缓存所有内容”这类规则，否则可能缓存接口响应。

## 出口与代理

- `cloudflared` 可以用 `--edge-bind-address` 指定本机出口 IP，用 `--edge-ip-version` 指定 IP 版本，但命令行帮助里没有上游代理参数。要走其他出口，需要让容器共用 WireGuard 或 tun2socks 等出口容器的网络。
- 这个出口只影响 `cloudflared` 到 Cloudflare 的连接，访问者看不到它，也不影响 Sub Forge 自身的出站请求。

## 上线检查

- [ ] 能通过 HTTPS 登录，并能正常保存数据
- [ ] 页面能实时刷新（SSE 正常）
- [ ] 实际客户端能拉取订阅
- [ ] 访问日志的“客户端 IP”是该设备的出口地址，“连接来源”是 Tunnel 的地址
- [ ] 请求带伪造的 `X-Forwarded-For: 198.51.100.66` 时，日志不会记录这个地址
- [ ] 公网无法访问服务器的 8080 端口，服务器也不再响应这个域名
- [ ] `/assets/*` 的 `cf-cache-status` 第二次请求显示 `HIT`
- [ ] 第一份备份已成功上传

## 已知限制

- **明文可见：** TLS 在 Cloudflare 终止，节点凭据、URL 里的订阅令牌和登录会话都会经过 Cloudflare。
- **出站仍暴露 IP：** 拉取订阅上游、Git 同步规则仓库和 WebDAV 备份都由后端直接发起，目标服务能看到服务器的真实 IP。后端目前没有出站代理配置。
- **DNS 历史和 SNI：** 如果这个域名曾经直接解析到服务器，历史记录可能暴露 IP。必要时换一个新子域名，并确认服务器不再响应它。
- **100 秒超时：** Cloudflare 大约等待 100 秒，超时返回 524。手动备份 `/api/system/backup/run` 和恢复 `/api/system/backup/restore` 都要等服务端处理完才返回，数据量大时可能超时。超时后请到系统页查看实际状态，不要立刻重复操作。定时备份不经过 Cloudflare，不受影响。
