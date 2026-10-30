# 部署与访问日志 IP 透传

## 日志含义与配置

首页访问日志、`GET /api/access-log` 和配置的访问历史返回：

| 字段 | 含义 |
| --- | --- |
| `clientIp` | 按可信代理链解析的客户端 IP；未启用信任时为连接对端 IP |
| `peerIp` | Node 实际 TCP 连接对端，不从 HTTP 请求头读取；可在 IP 单元格悬停查看 |
| `ipSource` | `socket`：连接来源；`x-forwarded-for`：可信代理透传；`unknown`：没有连接信息或历史记录 |

IPv4、IPv6 均可记录，IPv4 映射的 IPv6 规范化成 IPv4。SQLite v25 添加三个字段，旧日志地址保持 NULL，页面显示“未记录”，重启不补猜历史 IP。日志仍按令牌归属隔离、保留 30 天，只记录现有下载入口，不记录所有管理 API 请求。客户端使用 VPN、代理或运营商 NAT 时，记录的是到达部署入口的出口 IP，无法还原设备内网地址。

环境变量 `SUBFORGE_TRUSTED_PROXIES` 默认空，只允许逗号分隔的字面 IP 或 CIDR，例如 `172.30.80.2,2001:db8:10::2/128`。启动时验证，不接受主机名、跳数、`true`、`*` 或 `/0`；配置错误直接启动失败。不要把全部内网网段加入信任，只填写实际受控代理的地址或专用代理网段。

解析从 `peerIp` 开始：仅当对端可信，才读取 `X-Forwarded-For`，由右向左逐级跳过可信代理，在第一个非可信地址停止。该地址左侧的值不再使用。被核验的链段存在非法地址，或头部超过 4096 字符 / 32 项时，回退 `peerIp`。缺少连接信息时返回空值，不根据请求头推测地址。

应用只解析裸 IP 形式的 `X-Forwarded-For`。`X-Real-IP`、`Forwarded`、`CF-Connecting-IP` 均不自动信任；也不接收 PROXY protocol。统一由入口代理完成转换，可以避免多个头部的优先级冲突。Hono 的连接信息通过 Node 适配器取得，见 [Hono 官方文档](https://hono.dev/docs/helpers/conninfo)。

## 推荐拓扑：Nginx 与应用在同一 Docker 网络

```text
客户端 → HTTPS Nginx（专用容器 IP）→ HTTP sub-forge:8080
```

应用容器不发布宿主机端口；Nginx 负责 TLS，只有它发布 80 / 443。给代理配置固定网络地址，应用仅信任该地址。以下为需要合入现有 Compose 的应用和网络片段；网段、镜像名、域名、证书与密码按实际环境替换，网段不得与现有网络冲突：

```yaml
services:
  sub-forge:
    image: sub-forge
    environment:
      PUBLIC_URL: https://sub.example.com
      SUBFORGE_TRUSTED_PROXIES: 172.30.80.2
      # 首次创建管理员时提供 SUBFORGE_ADMIN_USERNAME / SUBFORGE_ADMIN_PASSWORD
    volumes:
      - sub-forge-data:/data
    networks:
      sub-forge-net: {}
    # 不配置 ports；镜像仍监听 0.0.0.0:8080
  # 在现有 Nginx 服务中增加：
  # networks:
  #   sub-forge-net:
  #     ipv4_address: 172.30.80.2
networks:
  sub-forge-net:
    ipam:
      config:
        - subnet: 172.30.80.0/24
volumes:
  sub-forge-data:
```

Nginx 直接面对客户端时，在已有 HTTPS `server` 内配置：

```nginx
location / {
    proxy_pass http://sub-forge:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 公网入口覆盖来访者自带的 XFF，不照抄用户输入。
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

应用的 `PUBLIC_URL` 仍须设置为真正的外部 HTTPS 地址，它决定生成链接及 Secure cookie，与客户端 IP 解析独立。后端不会根据来访者提供的 Host / X-Forwarded-Host 猜测公网地址。Nginx 的头部设置见 [代理模块官方文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。

## 宿主机 Nginx + Docker 应用

现有单容器 `docker run` 方案也可用，发布端口绑定到环回地址：

```bash
docker run -d --name sub-forge -p 127.0.0.1:8080:8080 \
  -v sub-forge-data:/data \
  -e PUBLIC_URL=https://sub.example.com \
  -e SUBFORGE_TRUSTED_PROXIES='<应用观察到的宿主机代理 IP>' \
  sub-forge
```

上面的占位 IP 必须替换，第一次可以省略信任变量，发起测试下载后从日志的“连接来源”读取 `peerIp`。Nginx 使用 `proxy_pass http://127.0.0.1:8080`，其他头部设置同上。确认对端属于该入口后，再把它配置为精确可信 IP 并重建应用容器；不要直接假定应用看到的一定是 `127.0.0.1` 或 `172.17.0.1`。

Docker bridge、端口映射、IPv6 到 IPv4 的用户态代理、Docker Desktop 虚拟机和 rootless 网络的对端地址可能不同。宿主机 NAT 之后，应用可能看到桥接网关；若外部请求也能绕过 Nginx 从同一网关进入，单靠可信 IP 无法区分它们。因此必须限制应用入口只供代理访问。优先采用上节的专用网络与未发布端口方案。参见 [Docker 端口发布](https://docs.docker.com/engine/network/port-publishing/) 和 [rootless 网络限制](https://docs.docker.com/engine/security/rootless/troubleshoot/)。

## 多级代理、CDN 与负载均衡

链路为“客户端 → 入口代理 → 内部代理 → 应用”时：

1. 公网入口覆盖 XFF 为实际连接来源。
2. 后续受控代理使用 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` 追加自身收到的连接对端。
3. 应用信任链上实际受控代理的 IP / CIDR。漏配某层会停在该代理 IP；不要为得到最左侧地址扩大到全网信任。

如果 Nginx 前面还有 CDN，推荐先在 Nginx 恢复地址，再向应用发送单个已验证 IP：只为 CDN 官方公布且保持更新的出口网段设置 `set_real_ip_from`，用 CDN 指定的真实 IP 头作为 `real_ip_header`。使用通用 XFF 的负载均衡可配置 `real_ip_recursive on`。恢复后仍使用 `proxy_set_header X-Forwarded-For $remote_addr`。应用只需信任最后一层 Nginx 的地址。CDN 专用头也必须受来源网段约束，不能看到头部就接受它。具体语义见 [Nginx realip 官方文档](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。

若前置的是四层负载均衡，且 SNAT 已丢失源 IP，需要它支持 PROXY protocol，并由受限入口的 Nginx `listen ... proxy_protocol` 接收和转换；不要直接向应用 8080 端口发送 PROXY protocol。已经丢失且没有透传的地址无法由应用恢复。

## 上线核验

- 从另一台设备经正式 HTTPS 域名下载自己的订阅 / 节点 / 规则，核对“客户端 IP”是否等于该设备出口地址；悬停核对 `peerIp` 是否为预期代理。
- 同一请求带 `X-Forwarded-For: 198.51.100.66`，日志不能因此变成伪造地址。再次携带 X-Real-IP、CF-Connecting-IP、Forwarded 验证入口策略。
- 从外部尝试访问后端 8080，推荐代理部署应无法绕行；再从 IPv6 客户端检查地址是否保留。
- 若持续显示网关或代理地址，逐层检查入口看到的来源、覆盖/追加规则、容器网络与信任变量，不能通过“信任所有地址”修正。
- 本地 Vite 开发代理不代表真实部署链路；未配置透传时日志记录本地连接来源，生产验收应走正式入口。

本次本地回归与内置浏览器验收不能代替实际生产的网络链路核验。部署前同时备份数据库和密钥；当前工作树不修改正在运行的实例或真实数据库。
