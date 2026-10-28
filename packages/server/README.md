# @sub-forge/server

订阅服务（M1 服务端切片）：SQLite 存储、上游拉取与快照、渲染缓存、订阅接口。目前只输出 mihomo，没有管理接口与登录，数据通过种子文件导入。

## 运行

```bash
pnpm install
SUBFORGE_DB=./data/sub-forge.db pnpm --filter @sub-forge/server seed examples/seed.example.json
SUBFORGE_DB=./data/sub-forge.db pnpm --filter @sub-forge/server start
curl http://127.0.0.1:8080/sub/demo-token
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBFORGE_DB` | `./data/sub-forge.db` | SQLite 文件路径 |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | 监听地址 |
| `PUBLIC_URL` | `http://HOST:PORT` | 对外地址，用于生成 provider 与规则集链接 |
| `SSRF_ALLOW` | 空 | 逗号分隔的白名单（主机名、IP 或 CIDR），允许拉取内网订阅 |
| `MIHOMO_BIN` | 空 | 设置后每次渲染都执行 `mihomo -t` 校验，失败时返回上一份成功结果 |
| `MIHOMO_DIR` | 临时目录 | `-t` 的工作目录；GEOIP 规则需要其中有 `Country.mmdb`，否则 mihomo 会尝试下载 |

## 接口

| 地址 | 内容 |
| --- | --- |
| `GET /sub/:token` | 主配置。`?target=mihomo\|surge&platform=...` 优先于 UA；Surge 暂返回 501 |
| `GET /p/:token/:key` | Profile 专属 provider 内容 |
| `GET /r/:token/:key` | 转换后的规则集 |
| `GET /healthz` | 健康检查 |

- token 无效：404，空响应体。
- 渲染失败（报告中有错误、`mihomo -t` 失败或内核异常）：返回上一份成功结果；从未成功过：503 与纯文本原因。
- 渲染结果与 token 无关，同一 Profile 的多个订阅链接共用缓存，下发时把地址里的占位符换成请求所用的 token。

## 上游拉取

- 订阅请求不等待上游：快照过期时先用旧快照渲染返回，后台刷新；只有从未拉取成功时才同步拉取。
- 同一 URL 的并发拉取合并为一次；成功快照保留最近 5 份，失败只记录最新一条。
- SSRF：禁止内网与保留地址。校验在建连时的 DNS 解析环节进行，重定向逐跳检查，DNS rebinding 同样受约束。

## 种子文件

结构见 `src/docs.ts` 的 `Seed`，示例见 `examples/seed.example.json`（演示源为本地内容，不需要联网）。同一模板的多个版本作为多条记录写入 `templates`，Profile 用 `follow: "latest"` 或 `{ "pinned": n }` 引用。

## 与设计文档的差异

- 存储用 better-sqlite3 直接读写 JSON 文档，没有用 05 建议的 Drizzle ORM：文档结构仍在频繁变化，暂不需要关系模型。
- 订阅源有多个 URL 且部分从未拉取成功时，只用成功的部分渲染；所有 URL 都失败时整个 Profile 渲染失败（成员级失败策略 COL-05 尚未实现）。
