# @sub-forge/server

订阅服务（M1 服务端）：SQLite 存储、多用户与登录、管理接口、上游拉取与快照、渲染缓存、订阅接口。目前只输出 mihomo，还没有前端。

## 运行

### 本地

```bash
pnpm install
export SUBFORGE_DB=./data/sub-forge.db
SUBFORGE_ADMIN_PASSWORD='至少8位' pnpm --filter @sub-forge/server exec tsx src/cli.ts create-admin admin
pnpm --filter @sub-forge/server exec tsx src/cli.ts seed examples/seed.example.json admin   # 可选：示例数据归属 admin
pnpm --filter @sub-forge/server start
curl http://127.0.0.1:8080/sub/demo-token
```

### Docker（生产，SYS-08）

```bash
docker build -f docker/Dockerfile -t sub-forge .
docker run -d --name sub-forge -p 8080:8080 -v sub-forge-data:/data \
  -e PUBLIC_URL=https://sub.example.com \
  -e SUBFORGE_ADMIN_USERNAME=admin -e SUBFORGE_ADMIN_PASSWORD='请改成强密码' \
  sub-forge
```

- 以非 root 用户运行；数据库与密钥文件 `secret.key`（0600）放在 `/data`，备份时两者一起备份，丢了密钥就无法解密数据。
- 首次启动且没有用户时按 `SUBFORGE_ADMIN_*` 创建管理员，之后可以去掉这两个变量。
- 对外请放在 HTTPS 反向代理之后；`PUBLIC_URL` 为 https 时会话 cookie 带 `Secure`。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBFORGE_DB` | `./data/sub-forge.db`（镜像中为 `/data/sub-forge.db`） | SQLite 文件路径 |
| `SUBFORGE_SECRET` | 数据库旁的 `secret.key` | 32 字节 Base64 主密钥，用于加密敏感数据（SYS-04）；不设置时首次启动自动生成 |
| `SUBFORGE_ADMIN_USERNAME` / `SUBFORGE_ADMIN_PASSWORD` | 空 | 首次启动时创建管理员；`create-admin` 命令也从 `SUBFORGE_ADMIN_PASSWORD` 取密码 |
| `HOST` / `PORT` | `127.0.0.1` / `8080`（镜像中 HOST 为 `0.0.0.0`） | 监听地址 |
| `PUBLIC_URL` | `http://HOST:PORT` | 对外地址，用于生成订阅、provider 与规则集链接；未设置时启动会告警 |
| `ALLOWED_ORIGINS` | 空 | 逗号分隔，允许跨源调用管理接口的 Origin（如前端开发服务器） |
| `SSRF_ALLOW` | 空 | 逗号分隔的白名单（主机名、IP 或 CIDR），允许拉取内网订阅 |
| `MIHOMO_BIN` | 空 | 设置后每次渲染都执行 `mihomo -t` 校验，失败时返回上一份成功结果 |
| `MIHOMO_DIR` | 临时目录 | `-t` 的工作目录；GEOIP 规则需要其中有 `Country.mmdb`，否则 mihomo 会尝试下载 |

## 订阅接口

| 地址 | 内容 |
| --- | --- |
| `GET /sub/:token` | 主配置。`?target=mihomo\|surge&platform=...` 优先于 UA；Surge 暂返回 501 |
| `GET /p/:token/:key` | Profile 专属 provider 内容 |
| `GET /r/:token/:key` | 转换后的规则集 |
| `GET /healthz` | 健康检查 |

- token 无效：404，空响应体。
- 渲染失败（报告中有错误、`mihomo -t` 失败或内核异常）：返回上一份成功结果；从未成功过：503 与纯文本原因。
- 渲染结果与 token 无关，同一 Profile 的多个订阅链接共用缓存，下发时把地址里的占位符换成请求所用的 token。

## 管理接口（`/api`）

返回 JSON，错误格式 `{ error, details? }`。会话用 HttpOnly + SameSite=Lax cookie；写操作要求 `content-type: application/json`，带 Origin 时须同源或在 `ALLOWED_ORIGINS` 中。

| 地址 | 说明 |
| --- | --- |
| `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`、`POST /api/me/password` | 登录与账户；连续 5 次失败锁定 15 分钟，改密码后其他会话失效 |
| `GET/POST /api/users`、`PATCH /api/users/:id` | 管理员：创建、禁用、改角色、重置密码、脚本权限 |
| `GET/POST /api/{kind}`、`GET/PUT/DELETE /api/{kind}/:id` | kind 为 `sources` `collections` `locals` `rulesets` `bundles` `profiles` `presets`。id 由服务端生成；按用户隔离（别人的文档一律 404）；预设由管理员维护、所有人可读；被引用的文档不能删除（409 返回引用方） |
| `GET /api/templates`、`GET /api/templates/:id`、`GET /api/templates/:id/versions/:v` | 所有人可读 |
| `POST /api/templates/validate` | 管理员：编辑器即时校验（TPL-11） |
| `POST /api/templates/:id/impact` | 管理员：用新版本对跟随最新的 Profile 试渲染，只看结果不发布 |
| `POST /api/templates/:id/publish` | 管理员：`:id` 为 `new` 时新建。自身校验不通过 400；有 Profile 会渲染失败时 409，带 `force: true` 才发布（TPL-07） |
| `GET/POST /api/profiles/:id/tokens`、`POST .../tokens/:token/reset`、`DELETE .../tokens/:token` | 订阅链接；重置后旧链接立即失效 |
| `POST /api/profiles/:id/preview` | 预览配置、依赖节点与渲染报告；请求体可带未保存的 `profile` 草稿 |
| `GET /api/profiles/:id/access-log` | 访问日志（保留 30 天） |
| `POST /api/sources/:id/refresh`、`GET /api/sources/:id/snapshots` | 立即拉取、快照历史 |
| `POST /api/{sources,collections}/:id/pipeline-preview` | 处理链逐步预览，可带未保存的 `pipeline` 草稿 |
| `POST /api/rulesets/:id/preview` | 规则集按 `client` + `platform` 的最终输出 |

保存前校验：必填项、正则能否编译、远程地址协议、脚本编写权限、引用是否存在且属于当前用户（规则集还可以是管理员名下的公共规则集）、组合是否成环、规则包层数。深层结构问题由预览与渲染报告给出。

## 上游拉取

- 订阅请求不等待上游：快照过期时先用旧快照渲染返回，后台刷新；只有从未拉取成功时才同步拉取。
- 同一 URL 的并发拉取合并为一次；成功快照保留最近 5 份，失败只记录最新一条。
- SSRF：禁止内网与保留地址。校验在建连时的 DNS 解析环节进行，重定向逐跳检查，DNS rebinding 同样受约束。

## 敏感数据

文档正文（含订阅地址、节点凭据）、快照正文、最近一次成功的渲染结果、订阅 token 均以 AES-256-GCM 加密落盘；token 以 HMAC 为索引，访问日志只记 HMAC 前缀；会话 ID 只存 HMAC；密码用 scrypt。旧版数据库启动时自动升级。

## 测试

- 单元测试：`pnpm --filter @sub-forge/server test`。
- `test/integration/upstream-real.test.ts`：真实连接下的拉取与 SSRF 校验，只访问回环地址，默认运行。
- `test/integration/e2e-mihomo.test.ts`：服务真实运行，mihomo 客户端用订阅地址加载配置并经代理链访问目标。需要 `MIHOMO` 与 `MIHOMO_RUNTIME=1`，推荐在 Docker 验证镜像中运行（仓库根目录 `pnpm test:docker`）。

## 种子文件

结构见 `src/docs.ts` 的 `Seed`，示例见 `examples/seed.example.json`（演示源为本地内容，不需要联网）。`seed <文件> <用户名>` 把有归属的文档写到该用户名下；不指定用户时文档无归属，登录后看不到，只能通过订阅接口使用。同一模板的多个版本作为多条记录写入 `templates`。

## 与设计文档的差异

- 存储用 better-sqlite3 直接读写 JSON 文档，没有用 05 建议的 Drizzle ORM：文档结构仍在频繁变化，暂不需要关系模型。
- 模板草稿只保存在前端，服务端只保存已发布的版本；编辑时用 `validate` 接口即时校验。
- 管理员共享订阅源 / 组合给指定用户（SYS-06）、模板可见性（TPL-08）尚未实现：目前模板对所有人可见，管理员名下的规则集可被所有人引用。
- 订阅源有多个 URL 且部分从未拉取成功时，只用成功的部分渲染；所有 URL 都失败时整个 Profile 渲染失败（成员级失败策略 COL-05 尚未实现）。
