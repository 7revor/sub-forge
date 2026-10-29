# @sub-forge/server

订阅服务（M1 服务端）：SQLite 存储、多用户与登录、管理接口、上游拉取与快照、渲染缓存、订阅接口。目前只输出 mihomo；生产镜像同源托管 `packages/web` 管理前端。

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
| `SSRF_ALLOW` | 空 | 逗号分隔的字面 IP / CIDR 白名单；兼容接受主机名，域名本身已默认放行 |
| `MIHOMO_BIN` | 空 | 设置后每次渲染都执行 `mihomo -t` 校验，失败时返回上一份成功结果 |
| `MIHOMO_DIR` | 临时目录 | `-t` 的工作目录；GEOIP 规则需要其中有 `Country.mmdb`，否则 mihomo 会尝试下载 |

## 订阅接口

| 地址 | 内容 |
| --- | --- |
| `GET /sub/:token` | 主配置。`?target=mihomo\|surge&platform=...` 优先于 UA；Surge 暂返回 501 |
| `GET /p/:token/:key` | Profile 专属 provider 内容 |
| `GET /r/:token/:key` | 转换后的规则集 |
| `GET /healthz` | 健康检查 |

- token 无效或所属用户被禁用：主订阅、节点与规则资源统一返回 404，空响应体。
- 渲染失败（报告中有错误、`mihomo -t` 失败或内核异常）：返回上一份成功结果；从未成功过：503 与纯文本原因。
- 渲染结果与 token 无关，同一 Profile 的多个订阅链接共用缓存，下发时把地址里的占位符换成请求所用的 token。
- 缓存命中时仍更新流量信息与拉取告警，并同步到最近成功结果。流量先按同源不同 URL 累加，再按 Profile 选择汇总、指定源或关闭；缺失字段不补零，到期时间取最早值，重复引用同一源不重复累加。仅流量变化不产生新的结构版本。
- 生成的 `/p` 与 `/r` 地址携带相同的结构版本 `v` 和输出平台；旧主配置读取旧版本资源。兼容的远程内容仍在原结构版本内刷新；结构变化等待下次主订阅刷新。每个 Profile / 输出目标保留最近 32 个结构版本，过期资源返回 404 并提示刷新主订阅。
- 升级前无版本规则链接无法恢复历史关联，已有客户端应刷新一次主订阅。完整更新和迁移说明见 [稳定化记录](../../docs/10-m1-stabilization.md)。

## 管理接口（`/api`）

返回 JSON，错误格式 `{ error, details? }`。会话用 HttpOnly + SameSite=Lax cookie；写操作要求 `content-type: application/json`，带 Origin 时须同源或在 `ALLOWED_ORIGINS` 中。

| 地址 | 说明 |
| --- | --- |
| `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`、`POST /api/me/password` | 登录与账户；连续 5 次失败锁定 15 分钟，改密码后其他会话失效 |
| `GET/POST /api/users`、`PATCH /api/users/:id` | 管理员：创建、禁用、改角色、重置密码、脚本权限 |
| `GET/POST /api/{kind}`、`GET/PUT/DELETE /api/{kind}/:id` | kind 为 `sources` `collections` `locals` `rulesets` `profiles` `presets`（规则包已并入规则集，2026-10-29 起没有 `bundles`）。规则集为 `{ name, sources: [...], overrides?: [{ match, override }], noResolve? }`，仍接受旧的单一来源写法（`kind` / `url` / `content` 平铺），保存时转成一个来源。id 由服务端生成；按用户隔离（别人的文档一律 404）；预设由管理员维护、所有人可读；被引用的文档不能删除（409 返回引用方） |
| `GET /api/templates`、`GET /api/templates/:id`、`GET /api/templates/:id/versions/:v` | 所有人可读 |
| `POST /api/templates/validate` | 管理员：编辑器即时校验（TPL-11） |
| `POST /api/templates/:id/impact` | 管理员：用新版本对跟随最新的 Profile 试渲染，只看结果不发布 |
| `POST /api/templates/:id/publish` | 管理员：`:id` 为 `new` 时新建。自身校验不通过 400；有 Profile 会渲染失败时 409，带 `force: true` 才发布（TPL-07） |
| `GET/POST /api/profiles/:id/tokens`、`POST .../tokens/:token/reset`、`DELETE .../tokens/:token` | 订阅链接；重置后旧链接立即失效 |
| `POST /api/profiles/:id/preview` | 预览配置、依赖节点与渲染报告；请求体可带未保存的 `profile` 草稿 |
| `POST /api/profiles/preview` | 新建草稿预览，请求体 `{ profile, platform? }`；不保存 Profile，不读写渲染缓存、last-good 或访问日志 |
| `GET /api/profiles/:id/access-log` | 访问日志（保留 30 天） |
| `POST /api/sources/:id/refresh`、`GET /api/sources/:id/snapshots` | 立即拉取、快照历史 |
| `POST /api/{sources,collections}/:id/pipeline-preview` | 处理链逐步预览，可带未保存的 `pipeline` 草稿；订阅源还可带 `source: { url, fetch }`，组合还可带 `members`（按保存规则校验引用与成环） |
| `GET /api/nodesets/:type/:id/nodes` | 自己的节点集经已保存处理链后的节点列表；type 为 `source` / `collection` / `local`，最多返回 5000 个，附总数、截断标记与报告 |
| `POST /api/rulesets/preview` | 规则集草稿按 `client` + `platform` 的输出，请求体 `{ ruleset, id?, source?, client, platform? }`：给出 `source` 时为该来源（含无法解析的行），否则为全部启用来源合并去重后的结果与 domain / classical / ipcidr 统计；两种预览均应用顶层 `overrides`（按规则内容精确匹配）；每个来源的拉取 / 解析状态一并返回，`rejected` 为完整计数，存在无法解析行时附带 `rejectedDetails`（行号、原文、原因，最多前 100 条），用于来源徽标的悬停与点击详情。`id` 为已保存的规则集时，已保存的远程地址读写它名下的快照；新建草稿与编辑中新填的地址只拉取、不写快照（同一地址 5 分钟内复用） |

本地节点在「原始配置」粘贴后先同步编辑草稿，点击「添加到分组 / 保存节点」时调用 `PUT /api/locals/:id`，提交完整分组；服务端校验通过后立即持久化并返回保存结果。该交互复用现有接口，不新增暂存状态或迁移。

### 占位接口（前端已有界面，服务端待实现）

定义在 `src/api/pending.ts`。读接口返回空数据并带 `pending: true`，写接口一律 501。

| 地址 | 前端页面 |
| --- | --- |
| `GET /api/users/stats` | 用户：每人的配置订阅数、订阅源数、最近订阅请求 |
| `GET/POST /api/shares`、`DELETE /api/shares/:id` | 用户：共享订阅源 / 组合（SYS-06） |
| `GET /api/rule-repos`、`GET /api/rule-repos/search`、`GET /api/rule-repos/entry`、`POST /api/rule-repos/import`、`POST /api/rule-repos`、`DELETE /api/rule-repos/:id` | 规则仓库（RS-07，见 docs/08）与系统页的仓库管理 |
| `GET/PUT /api/system`、`POST /api/system/backup`、`POST /api/system/restore` | 系统：SSRF 白名单、mihomo 校验开关、GitHub 镜像、备份恢复 |

订阅源保存格式为 `{ name, url, fetch?, pipeline? }`，`url` 必须是单个 HTTP(S) 地址。旧客户端的单元素 `urls` 可自动转换；空数组、多元素数组、非字符串地址以及同时提供 `url` / `urls` 均返回 400。读取只返回 `url`。多个来源应各建一个订阅源并加入组合。

保存前校验：必填项、正则能否编译、远程地址协议、脚本编写权限、引用是否存在且属于当前用户（规则集还可以是管理员名下的公共规则集）、组合是否成环、规则集来源（id 唯一、远程地址协议、mrs 的 behavior）。深层结构问题由预览与渲染报告给出。

订阅源基础设置中的拉取参数草稿与正式配置不同的时候，按草稿地址、User-Agent 和超时拉取并预览；结果只保留最多 16 组、60 秒的内存缓存，不写文档或正式快照。相同参数下调整处理链复用拉取结果；未修改参数时继续使用正式快照。草稿的单个地址失败时返回空节点和错误报告，不展示旧地址的节点。

处理链的创建、更新和草稿预览统一检查每个处理器的数组、对象、标量类型、枚举及正则 flags。非法参数返回带步骤位置的 400，禁用步骤也须满足结构要求；空数组与空正则占位仍允许，脚本编写权限不变。

「添加旗帜」的草稿预览与最终渲染共用内核地区识别：流量、到期等说明节点不添加旗帜；如需从输出中删除说明节点，可在前一步添加 `filter.useless`。

模板的即时校验、影响分析与发布都会检查启用规则集中每个启用的文本来源能否取得并解析，不依赖已有 Profile。无可用内容时禁止发布，`force` 不能绕过自身错误；有可用旧快照时允许发布并告警。二进制透传仅标注由客户端检查，不宣称服务端已验证内容或可达性。

## 上游拉取

- 订阅请求不等待上游：快照过期时先用旧快照渲染返回，后台刷新；只有从未拉取成功时才同步拉取。
- 同一 URL 的并发拉取合并为一次；成功快照保留最近 5 份，失败只记录最新一条。
- 文本规则集写入成功快照前按声明格式解析：空响应、错误页面、损坏的 YAML 和完全没有可用规则的内容均记为失败，继续使用旧快照；部分行有效时保留有效规则并在报告中记录被忽略的行。二进制透传资源仍由客户端直接下载。
- 旧库中已保存的无效远程规则快照也不能生成成功配置：使用最近成功配置回退，没有可回退配置时返回 503。有效规则经客户端覆盖主动全部丢弃不受此限制。
- 订阅只拉取模板与个人覆盖合并后实际启用的规则依赖；禁用规则、失效锚点规则及规则集中停用的来源不会触发上游请求。
- 地址限制：仅禁止 URL 中直接填写的内网 / 保留 IP，重定向逐跳检查协议与字面 IP；域名按系统 DNS 解析，解析结果即使是 Fake-IP 或内网地址也允许连接。此策略不提供 DNS rebinding 防护。

## 敏感数据

文档正文（含订阅地址、节点凭据）、快照 URL / 正文 / 错误、最近一次成功的渲染结果与保留的结构版本、订阅 token 均以 AES-256-GCM 加密落盘；快照 URL 与 token 以 HMAC 为查询索引，访问日志只记 token 的 HMAC 前缀；会话 ID 只存 HMAC；密码用 scrypt。旧版数据库启动时自动升级，迁移后清理快照旧明文所在的空闲页与 WAL；v6 起本地节点上的前置迁移为配置订阅中的链规则（本地节点只录入节点信息）；v7 把旧规则集与规则包统一迁移为多来源规则集，同时保留归属、引用与远程快照；v8 提升规则集客户端改写为组级；v9 将订阅源的单元素 `urls` 转为 `url`，保留更新时间和快照，意外多地址会使迁移事务回滚。合并前两条分支都曾使用 v8，因此 v9 幂等补齐规则集改写与单地址两项转换，兼容任一分支已升级的数据。

## 测试

- 单元测试：`pnpm --filter @sub-forge/server test`。
- 六项后端修复新增 80 项回归，覆盖快照、有效依赖、模板自检、流量缓存与处理链参数；原多 URL 用例已按单地址模型改为失败回退与跨源汇总。验收与边界见 [修复记录](../../docs/12-backend-regression-fixes.md)。
- `test/integration/upstream-real.test.ts`：真实连接下的拉取与 SSRF 校验，只访问回环地址，默认运行。
- `test/integration/e2e-mihomo.test.ts`：服务真实运行，mihomo 客户端用订阅地址加载配置并经代理链访问目标。需要 `MIHOMO` 与 `MIHOMO_RUNTIME=1`，推荐在 Docker 验证镜像中运行（仓库根目录 `pnpm test:docker`）。

## 种子文件

结构见 `src/docs.ts` 的 `Seed`，示例见 `examples/seed.example.json`（演示订阅只用本地节点组，不需要联网；远程订阅源使用单个 `url`，旧版单元素 `urls` 导入时转换，多地址会导致整批导入回滚；旧种子里 `kind: "local"` 的订阅源导入时自动转为本地节点组；单一来源写法的旧规则集转为一个来源，旧的 `bundles` 转为同 id 的多来源规则集；本地节点不设置前置，旧种子里节点上的前置导入时转为直接使用该分组的配置订阅中的链规则）。`seed <文件> <用户名>` 把有归属的文档写到该用户名下；不指定用户时文档无归属，登录后看不到，只能通过订阅接口使用。同一模板的多个版本作为多条记录写入 `templates`。

## 与设计文档的差异

- 存储用 better-sqlite3 直接读写 JSON 文档，没有用 05 建议的 Drizzle ORM：文档结构仍在频繁变化，暂不需要关系模型。
- 模板草稿只保存在前端，服务端只保存已发布的版本；编辑时用 `validate` 接口即时校验。
- 2026-10-29 前端只向管理员展示一个模板入口；普通用户仍需通过现有只读模板接口在配置订阅向导中选择已发布版本。服务端的模板读写权限与种子格式未变。
- 管理员共享订阅源 / 组合给指定用户（SYS-06）、模板可见性（TPL-08）尚未实现：目前模板对所有人可见，管理员名下的规则集可被所有人引用。
- 订阅源只拉取一个 URL；拉取失败时使用该地址上一份成功快照并告警，没有可用成功快照时整个 Profile 渲染失败并尝试 last-good 回退。流量读取该源的快照；跨源汇总按源 ID 去重。组合成员整体不可用时仍失败，成员级失败策略 COL-05 尚未实现：前端可设置组合成员的 `onFail` 并随文档保存，渲染尚未读取。
- 配置订阅基础设置的原样片段（`base.raw`，BS-04）随文档保存，渲染尚未输出。
