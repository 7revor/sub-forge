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
- 最终运行镜像在构建时通过 apt 安装 `git` 和 `ca-certificates`，宿主机无需安装 Git，容器启动时无需安装软件。可运行 `docker run --rm --entrypoint git sub-forge --version` 检查。默认 Git 缓存位于 `/data/rule-repo-cache`，上述 `/data` 卷会一并持久化；自定义 `SUBFORGE_REPO_CACHE` 时须保证该目录可由容器的 node 用户写入并单独挂载。
- 首次启动且没有用户时按 `SUBFORGE_ADMIN_*` 创建管理员，之后可以去掉这两个变量。
- 对外请放在 HTTPS 反向代理之后；`PUBLIC_URL` 为 https 时会话 cookie 带 `Secure`。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBFORGE_DB` | `./data/sub-forge.db`（镜像中为 `/data/sub-forge.db`） | SQLite 文件路径 |
| `SUBFORGE_REPO_CACHE` | 数据库同目录的 `rule-repo-cache` | 公开规则仓库的 Git 缓存，需可写且建议持久化；本地运行需安装 Git，生产镜像已包含 |
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
| `POST /api/templates/:id/publish` | 管理员：`:id` 为 `new` 时新建。自身校验不通过 400；绑定订阅渲染失败或检查期间发生并发修改时 409，绑定冲突不允许 `force` 跳过（TPL-07、PRF-12） |
| `GET/POST /api/profiles/:id/tokens`、`POST .../tokens/:token/reset`、`DELETE .../tokens/:token` | 订阅链接；重置后旧链接立即失效 |
| `POST /api/profiles/:id/preview` | 预览配置、依赖节点与渲染报告；请求体可带未保存的 `profile` 草稿 |
| `POST /api/profiles/preview` | 新建草稿预览，请求体 `{ profile, platform? }`；不保存 Profile，不读写渲染缓存、last-good 或访问日志 |
| `GET /api/profiles/:id/access-log` | 访问日志（保留 30 天） |
| `POST /api/sources/:id/refresh`、`GET /api/sources/:id/snapshots` | 立即拉取、最近成功内容与最新失败状态（不含正文） |
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
| `GET/PUT /api/system`、`POST /api/system/backup`、`POST /api/system/restore` | 系统：SSRF 白名单、mihomo 校验开关、备份恢复 |

订阅源保存格式为 `{ name, url, fetch?, pipeline? }`，`url` 必须是单个 HTTP(S) 地址。旧客户端的单元素 `urls` 可自动转换；空数组、多元素数组、非字符串地址以及同时提供 `url` / `urls` 均返回 400。读取只返回 `url`。多个来源应各建一个订阅源并加入组合。

保存前校验：必填项、正则能否编译、远程地址协议、脚本编写权限、引用是否存在且属于当前用户（规则集还可以是管理员名下的公共规则集）、组合是否成环、规则集来源（id 唯一、远程地址协议、mrs 的 behavior）。深层结构问题由预览与渲染报告给出。

订阅源草稿地址与正式配置不同的时候，按草稿地址拉取并预览；UA 固定为 `clash.meta`，超时固定为 10 秒，旧请求中的自定义值会被忽略；结果只保留最多 16 组、60 秒的内存缓存，不写文档或正式快照。相同地址下调整处理链复用拉取结果；仅修改自动更新时间继续使用正式快照。草稿的单个地址失败时返回空节点和错误报告，不展示旧地址的节点。

处理链的创建、更新和草稿预览统一检查每个处理器的数组、对象、标量类型、枚举及正则 flags。非法参数返回带步骤位置的 400，禁用步骤也须满足结构要求；空数组与空正则占位仍允许，脚本编写权限不变。

「添加旗帜」的草稿预览与最终渲染共用内核地区识别：流量、到期等说明节点不添加旗帜；如需从输出中删除说明节点，可在前一步添加 `filter.useless`。

模板的即时校验、影响分析与发布都会检查启用规则集中每个启用的文本来源能否取得并解析，不依赖已有 Profile。无可用内容时禁止发布，`force` 不能绕过自身错误；有可用旧快照时允许发布并告警。二进制透传仅标注由客户端检查，不宣称服务端已验证内容或可达性。

## 上游拉取

- 订阅请求不等待上游：超过自动更新间隔后，下次读取先用旧内容返回并后台刷新；只有当前地址从未拉取成功时才同步拉取。默认 24 小时，最短 5 分钟；这不是独立定时任务。
- 同一来源、同一 URL 的并发拉取合并为一次；每个订阅源仅保留最近一次成功内容及最新失败状态，换地址也不累积历史；规则集每个 URL 仍保留最近 5 份成功快照和最新失败记录。
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


## 内置与自定义规则仓库

服务初始化自动建立 blackmatrix7 / zydou 元数据，`serve` 启动后台索引；每日检查各分支 commit，更新失败保留旧索引并在 15 分钟后重试，退出前停止定时器并等待当前任务。SQLite v10 新增公共索引表，用户规则文档仍加密存储。

- `GET /api/rule-repos`：状态与数量（需要登录）。
- `GET /api/rule-repos/search?q=&repo=&client=&offset=0&limit=50`：归一化名称搜索，最大 100 条/页。
- `GET /api/rule-repos/entry?repo=&path=`：变体、上游链接、许可证及推荐文本预览；网络错误明确返回。
- `POST /api/rule-repos/import`：`{ repo, path, variant?, ruleset? }`，新建当前用户的规则集或向其已有规则集追加选中文本来源，按 URL 防重复。
- `POST /api/rule-repos/:id/refresh`：管理员触发，202 返回后通过列表轮询状态；同仓库并发任务合并。
- `PATCH /api/rule-repos/:id`：管理员设置 `{ enabled: boolean }`，停用不删除索引或已导入的规则集。

仓库识别、分支检查与目录索引均使用匿名 HTTPS Git，不依赖 GitHub API。仅索引 list/txt；失败保留旧索引。完整行为见下方「规则仓库 Git 缓存与编辑」与 [08](../../docs/08-rule-repository-index.md)。示例种子保持离线可用。

### 自定义 GitHub 仓库

管理员 `POST /api/rule-repos`：`{url,name?,ref?,directory?,include?,exclude?,format?}`，成功 201 返回 id 并异步索引。`ref` 留空取默认分支；include/exclude 为相对扫描目录的 glob 数组，format 默认 auto，仅支持文本格式。`DELETE /api/rule-repos/:id` 删除自定义配置与索引（索引中返回 409），已导入远程来源保留。普通用户可搜索、预览和导入，不能管理仓库。

SQLite v11 为 `rule_repos` 添加可空 `definition`；v10 原索引、文档与内置状态保留。generic 适配器以完整文件路径为 key，每个文件一个条目，详情返回 rejected/rejectedDetails（最多 50 条，每条正文最多 500 字符）。导入前复用核心解析器校验，无有效规则返回 400。无需改变领域规则结构或离线种子；示例种子不包含全局仓库管理元数据。


### 仓库关联来源

`POST /api/rule-repos/resolve` 接收 `{ repo, path, variant? }`，返回 `{ name, sources }`（含来源 ID、repository 标识与规范 URL），仅解析、不保存规则集。导入接口同样保留关联标识；新建/保存和草稿预览均拒绝伪造或修改关联地址、移除既有关联标识。旧导入按名称与完整 URL 精确命中索引后补齐标识。示例种子附带默认停用且不被配置引用的关联示例，不触发额外远程拉取。

### 2026-10-29：仅文本索引

所有仓库只索引 `.list` / `.txt`，任意 include 也不能放开 YAML、MRS、SRS 等后缀。zydou 只检查两个 Surge 文本分支。启动即清理旧缓存中的不支持变体，并使相关仓库同 commit 也重建；既有规则来源保留。自定义仓库旧 YAML 格式配置降为 auto，不改 include/exclude。手动远程 YAML 不受索引限制，预览报告 `conversion: yaml-to-list`，实际 provider 使用本服务文本 URL；已知 YAML 输入不得标为二进制透传。

### 移除 GitHub Token（2026-10-29）

不再提供 GitHub Token 配置或 `GET/PUT/DELETE /api/rule-repos/github-token` 接口。SQLite v14 升级删除旧 `github-index-token`，清空后删除专用 `server_secrets` 表；若存在未知其他服务凭据则保留其记录和表。订阅令牌及业务文档不受影响。迁移使用 secure_delete 并截断 WAL；外部备份不在迁移范围内。

### 按单文件创建规则集

`GET /api/rule-repos/files` 按 `repo` 与条目 `path` 返回去重的文本文件清单，不访问上游。`POST /api/rule-repos/import` 可传 `file: { ref, path }`，只创建该文件的仓库关联来源；不得与 `variant` 同传。创建前检查索引成员资格、启用状态及实际文本内容，已有规则集继续校验归属并按 URL 去重。

### 本地节点连通性测试

配置 `MIHOMO_BIN` 为可执行 Mihomo 的绝对路径后，本地节点编辑页可测试当前未保存草稿。未配置或不可执行时显示「测试服务未配置」。生产镜像默认不包含内核，需由部署方安装或挂载；此功能目前支持 Linux/macOS。

- `GET /api/node-probe`：返回测试服务是否可用。
- `POST /api/node-probe`：登录后提交 `{ requestId, node }`；不会保存草稿或测试结果。
- `DELETE /api/node-probe/:requestId`：仅发起用户可取消自己的测试。
- 使用独立临时目录和 Unix socket 启动内核，不开启代理入站；通过节点实际请求 `https://www.gstatic.com/generate_204`，接受 HTTP 2xx 后返回耗时。结果反映 **Sub Forge 服务端** 的网络，不代表访问管理页面的设备。
- 单用户最多一个测试，全服务最多两个；代理请求上限 10 秒，整个任务上限约 15 秒，退出时先终止、必要时强制结束内核，并删除临时配置。正常关闭服务会等待清理。
- 沿用现有 `SSRF_ALLOW` 字面 IP 白名单策略（域名仍按系统解析）；代理链、文件证书、网卡绑定及非内置插件不支持服务端探测。支持 SS、VMess、VLESS、Trojan、Hysteria 2、TUIC、AnyTLS、SOCKS5 和 HTTP。
- 原始内核日志不返回客户端，避免错误信息泄漏凭据。配置基础校验通过不等于连通性成功，测试失败不阻止保存。

实现依据：[Mihomo 代理延迟 API](https://wiki.metacubex.one/api/#proxiesproxies_namedelay)、[Unix socket 控制器](https://wiki.metacubex.one/config/general/#外部控制-api)。


## 规则仓库 Git 缓存与编辑

SQLite v13 将仓库当前配置与上次成功索引的配置分开保存。两个默认仓库仅在首次初始化时写入；之后与自定义仓库一样可编辑、停用或删除，重启不会恢复已删除的默认仓库。旧内置配置和自定义单分支配置自动迁移，已导入来源及其分支 URL 保持不变。

每个扫描范围可配置分支、相对目录、包含/排除 glob、格式、客户端、分组、推荐文件模式及 README 使用说明解析。范围重叠时先匹配的配置生效。`PUT /api/rule-repos/:id` 接收完整配置及读取时返回的 `configRevision`；并发旧版本返回 409。停用仓库保存后不自动联网同步，重新启用时更新。

目录同步通过公开 HTTPS Git 执行：使用裸仓库、`fetch --atomic --depth=1 --filter=blob:none --no-tags` 获取所有配置分支，再按固定 commit 执行 `ls-tree -r -z`。浅历史不限制目录层级；不检出工作目录，不递归子模块，不索引符号链接。提交和配置均未变化时跳过目录扫描。发生变化时从本地完整重建文件目录索引，并在一个 SQLite 事务中替换条目、配置快照和分支 SHA。任一步失败都保留上次成功的完整索引；成功扫描无匹配文件则保存空索引。

文件预览和导入前校验通过 `git show <commit>:<path>` 按需获取正文并缓存。导入后的远程来源仍跟踪分支，沿用既有快照刷新机制。迁移前未携带 commit 的旧索引暂时沿用原读取方式，首次 Git 更新后切换。仓库配置修改期间，旧索引使用旧仓库地址与旧配置，不拼接新地址。

默认每 24 小时同步；失败后 15 分钟重试；可手动更新。Git 操作有进程内串行队列、磁盘锁、120 秒超时和 32 MiB 输出上限；退出时取消并等待 Git 进程组。崩溃遗留锁在确认所属进程不存在后自动恢复。单个缓存目录不支持多个主机共享。删除仓库时删除其 Git 缓存，但保留已导入规则集。缓存不是用户配置备份：如需释放累计 Git 对象，可在停止服务后清空专用缓存目录，启动后手动更新仓库重建缓存；重建完成前文件预览可能不可用，SQLite 中的旧目录仍保留。

新增和修改仓库统一使用 `git ls-remote --symref` 读取远程 HEAD 与分支，留空分支按远程 HEAD 解析；所有指定分支均在保存前验证。仓库无提交、默认分支无法识别或指定分支不存在会明确报错，不写入配置。Git 失败返回 502；保存时需要访问 github.com，包括停用仓库的编辑。

全流程使用匿名公开仓库 HTTPS，不读取或写入 GitHub Token，不继承全局 Git URL 重写及认证配置，不调用 GitHub API。重命名/迁移的上游地址须编辑为当前地址。Git 不提供平台许可证分类：同仓库保留已有说明，新仓库默认「见上游仓库许可证」，也可手动填写许可证说明。

隔离浏览器验收：构建 web 后运行 `pnpm --filter @sub-forge/server exec tsx test/manual-git-repository-server.ts`，访问 `http://git-only.localhost:18744`。使用内存库、临时 Git 缓存和专用测试账号，允许真实匿名 Git、禁止全部 HTTP 上游请求；退出打印 HTTP 请求计数并清理缓存和进程。不得用于生产部署。

### 自动识别规则格式与下载策略（2026-10-29）

规则来源 API 可省略 format，缺省 auto；旧文本 format 只保留方言兼容，解析、快照校验、仓库导入与模板自检均按实际内容识别。规则预览返回来源的 format/behavior，以及整组 delivery（original/managed/unsupported）。单来源兼容时订阅配置引用原始 URL 并填写实际 format/behavior；其余可解析文本输出一个带版本参数的 `/r/:token/rs_…_classical.list`，内容为 classical，IP 选项写在各自规则行内。旧版本资源路由保持可读。旧二进制来源遇到合并、改写或客户端不支持时明确报错，沿用 last-good 回退，不静默丢弃。未增加 MRS/SRS 解码器；当前完整订阅下载仍只有 mihomo，Surge 为规则预览。

### 管理列表分页

`GET /api/{sources,profiles,collections,locals,rulesets,presets,templates}` 支持 `page`、`pageSize`、`q`。传任一参数即启用分页，默认第 1 页、每页 20 条，`pageSize` 范围 1–100；非法页码或条数返回 400。返回 `{ items, total, page, pageSize, totalPages }`，计数仅包含当前用户可见且名称匹配的结果（模板、预设沿用共享读取权限）。模板仅计最新版本；名称搜索忽略首尾空白和大小写，无名称的历史模板按 ID 搜索。顺序保持 ID 升序，越界页回退至最后一页，空结果为第 1 / 1 页。

不传参数仍返回全量 `{ items }`，兼容关联选择器及旧客户端。无搜索时通过 SQLite `LIMIT/OFFSET` 分页；文档正文保持加密，名称搜索在服务端解密后筛选，不新增明文名称索引。

### 模板规则集统一引用（2026-10-29）

- `GET /api/rule-options/search?q=&offset=0&limit=30&scope=all`：统一搜索可见本地与已启用仓库条目，返回 items/total/notices；scope=repository 用于本地规则集维护。
- `GET /api/rule-options/locals`：返回可引用本地规则集的 ID/名称（本人及管理员公共规则），不改变仅本人可维护的文档列表。
- `POST /api/rule-options/resolve`：请求 `{ source: 'local', id }` 或 `{ source: 'repository', repo, entry }`，返回 matcher，不创建本地规则集。
- 仓库 matcher 保存所选文件映射及稳定身份；新引用检查索引，已发布映射在索引移除或仓库停用后保持可用。删除被模板/配置订阅直接引用的仓库返回 409 和引用方。本地规则集自身被引用时仍禁止删除。
- 模板自检与渲染统一解析引用，失败诊断可以定位到规则行。前端 YAML 中的引用映射不会出现在最终订阅输出中。

隔离浏览器验收：先构建 web，再运行 `pnpm --filter @sub-forge/server exec tsx test/manual-rule-reference-server.ts`。只监听 127.0.0.1:5186，使用内存库、测试账号和固定上游；退出时关闭监听与数据库，不连接生产数据。验收结束必须停止进程。

2026-10-29 模板规则集行内编辑复用现有搜索/解析及模板自检、发布接口；客户端只替换 matcher，保持规则身份、顺序、出口、启用和 noResolve，服务端无需新接口或数据迁移。示例种子无需调整。

2026-10-29 规则集前端移除整组 no-resolve 配置入口及列表列；接口继续接受并保留 `noResolve`，历史设置的保存、预览和渲染行为不变，无需迁移，示例种子无需调整。

### 订阅源固定拉取设置（2026-10-29）

SQLite v15 清除订阅源旧 UA / 超时，只保留 `fetch.ttlSec`，保留文档归属和更新时间；订阅源历史压缩为最近一次成功及最新失败状态。规则集拉取设置和历史不受影响。服务层对正式拉取、草稿预览都强制使用默认 UA 与 10 秒超时，旧种子与保存接口也会规范化。节点只能内联输出或由本服务 `/p/…` 托管，不提供节点订阅地址透传；规则集仍按既有条件决定原格式透传或托管。

## 模板关系与旧数据升级（数据库 v16）

新订阅保存 `routing.mode = bound | independent`、空 `overlay` 与 `revision`。绑定只允许模板 ID 和 `groupAdditions`，保存须带 GET 返回的 `templateVersion`；独立保存完整 groups/rules/final，初始化来源仅作说明。旧的 template/overlay 创建请求与种子会自动转换，新模式 PUT 不允许回退为旧形状。

- `POST /api/profiles/routing/convert`：`{ profile, mode, currentTemplateVersion?, templateId?, templateVersion?, mapping? }`。只返回 `{ item, changes }` 草稿；mapping 以旧组 ID 映射目标 ID，null 表示明确不迁移。应用后通过原 PUT 保存，revision 过期返回 409。
- `GET /api/profiles/:id/migration-backup`：仅订阅所有者可读，返回 `{ item: 原始文档 }`；备份在库内加密，删除订阅时一并删除。
- 模板 impact/publish 仅影响绑定订阅。组改名保留成员；删组和合并环等冲突不能强制发布。发布检查中的并发更新要求重试。

升级前先停止写入并保留完整数据库一致性备份及原密钥（运行中的 SQLite 使用 backup API，不能只复制主文件遗漏 WAL）。可在现有库上执行只读预检：

```bash
SUBFORGE_DB=/绝对路径/sub-forge.db pnpm --filter @sub-forge/server exec tsx src/cli.ts profile-migration-plan
```

预检读取数据库旁 `secret.key` 或现有 `SUBFORGE_SECRET`，不会生成新密钥、修改源库或输出完整配置。它在临时一致性副本上执行迁移并清理副本；任何失败均报错退出。审核清单后启动新版服务，数据库自动在事务内升级到 v16。纯追加、跟随最新且无诊断的旧订阅继续绑定；其他配置完整展开为独立模式，原始文档另外加密保存。

订阅 ID、归属、链接、基础设置、节点源、代理链及 last-good/版本资源保留；迁移前后有效分流配置必须一致。历史孤儿项原本不生效，留在备份与诊断中。缺失模板版本或旧合并错误会中止整批迁移，不能靠丢弃配置继续启动；修复旧库后再试。回退旧程序应恢复升级前整库及对应密钥，单份 Profile 备份不等于数据库降级工具。

示例种子保留原 `demo` 的筛选配置及 `demo-token`，将其完整展开为独立模式；另有 `demo-bound` / `demo-bound-token` 演示纯成员绑定。
