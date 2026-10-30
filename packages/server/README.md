# @sub-forge/server

订阅服务（M1 服务端）：SQLite 存储、多用户与登录、管理接口、上游拉取与快照、实时渲染、订阅接口。目前只输出 mihomo；生产镜像同源托管 `packages/web` 管理前端。

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
| `GET /sub/:token` | 主配置。`?target=mihomo\|surge\|stash&platform=...` 优先于 UA；Surge 暂返回 501 |
| `GET /p/:token/:key` | Profile 专属 provider 内容 |
| `GET /r/:token/:key` | 转换后的规则集 |
| `GET /healthz` | 健康检查 |

- token 无效或所属用户被禁用：主订阅、节点与规则资源统一返回 404，空响应体。
- 渲染失败（报告中有错误、`mihomo -t` 失败或内核异常）：返回上一份成功结果；从未成功过：503 与纯文本原因。
- 渲染结果与 token 无关，同一 Profile 的多个订阅链接共用 last_good 和结构版本资源，下发时把地址里的占位符换成请求所用的 token。
- 每次渲染读取当前流量信息与拉取告警，并同步到最近成功结果。流量先按同源不同 URL 累加，再按 Profile 选择汇总、指定源或关闭；缺失字段不补零，到期时间取最早值，重复引用同一源不重复累加。仅流量变化不产生新的结构版本。
- 生成的 `/p` 与 `/r` 地址携带相同的结构版本 `v` 和输出平台；旧主配置读取旧版本资源。兼容的远程内容仍在原结构版本内刷新；结构变化等待下次主订阅刷新。每个 Profile / 输出目标保留最近 32 个结构版本，过期资源返回 404 并提示刷新主订阅。
- 升级前无版本规则链接无法恢复历史关联，已有客户端应刷新一次主订阅。完整更新和迁移说明见 [稳定化记录](../../docs/10-m1-stabilization.md)。

## 管理接口（`/api`）

返回 JSON，错误格式 `{ error, details? }`。会话用 HttpOnly + SameSite=Lax cookie；写操作要求 `content-type: application/json`，带 Origin 时须同源或在 `ALLOWED_ORIGINS` 中。

| 地址 | 说明 |
| --- | --- |
| `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`、`POST /api/me/password` | 登录与账户；连续 5 次失败锁定 15 分钟，改密码后其他会话失效 |
| `GET/POST /api/users`、`PATCH /api/users/:id` | 管理员：创建、禁用、改角色、重置密码、脚本权限 |
| `GET/POST /api/{kind}`、`GET/PUT/DELETE /api/{kind}/:id` | kind 为 `sources` `collections` `locals` `rulesets` `profiles` `presets`（规则包已并入规则集，2026-10-29 起没有 `bundles`）。规则集为 `{ name, sources: [...], overrides?: [{ match, override }], noResolve? }`，仍接受旧的单一来源写法（`kind` / `url` / `content` 平铺），保存时转成一个来源。id 由服务端生成；按用户隔离（别人的文档一律 404）；预设由管理员维护、所有人可读；被引用的文档不能删除（409 返回引用方） |
| `GET /api/templates`、`GET /api/templates/:id` | 所有人可读 |
| `POST /api/templates/validate` | 管理员：编辑器即时校验（TPL-11） |
| `POST /api/templates/:id/impact` | 管理员：用新版本对跟随最新的 Profile 试渲染，只看结果不发布 |
| `POST /api/templates`、`PUT /api/templates/:id` | 管理员新建或直接保存；不需要版本号，后保存的内容覆盖当前内容。自身校验不通过 400；绑定冲突返回 409，不允许 `force` 跳过。旧 `POST /api/templates/:id/publish` 兼容同一保存逻辑，不再创建历史 |
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

订阅源草稿地址与正式配置不同的时候，按草稿地址拉取并预览；UA 固定为 `clash.meta`，超时固定为 10 秒，旧请求中的自定义值会被忽略；不保留已完成草稿的时间缓存，不写文档或正式快照；仅合并相同在途请求。草稿的单个地址失败时返回空节点和错误报告，不展示旧地址的节点。

处理链的创建、更新和草稿预览统一检查每个处理器的数组、对象、标量类型、枚举及正则 flags。非法参数返回带步骤位置的 400，禁用步骤也须满足结构要求；空数组与空正则占位仍允许，脚本编写权限不变。

「添加旗帜」的草稿预览与最终渲染共用内核地区识别：流量、到期等说明节点不添加旗帜；如需从输出中删除说明节点，可在前一步添加 `filter.useless`。

模板的即时校验、影响分析与保存都会检查启用规则集中每个启用的文本来源能否取得并解析，不依赖已有 Profile。无可用内容时禁止保存，`force` 不能绕过自身错误；有可用旧快照时允许保存并告警。MRS 先校验再托管，SRS 明确不支持。

## 上游拉取

- 系统统一周期默认 24 小时、最小 1 小时；后台每分钟检查到期资源，到期读取等待刷新，失败才使用旧内容并延后一个周期重试。
- 同权限范围、资源类型、URL 与参数共享成功原文及在途请求；每种资源只保留一份成功内容和最新失败记录。
- 文本规则集写入成功快照前按声明格式解析：空响应、错误页面、损坏的 YAML 和完全没有可用规则的内容均记为失败，继续使用旧快照；部分行有效时保留有效规则并在报告中记录被忽略的行。MRS 校验成功后通过本服务原字节下发。
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

结构见 `src/docs.ts` 的 `Seed`，示例见 `examples/seed.example.json`（演示订阅只用本地节点组，不需要联网；远程订阅源使用单个 `url`，旧版单元素 `urls` 导入时转换，多地址会导致整批导入回滚；旧种子里 `kind: "local"` 的订阅源导入时自动转为本地节点组；单一来源写法的旧规则集转为一个来源，旧的 `bundles` 转为同 id 的多来源规则集；本地节点不设置前置，旧种子里节点上的前置导入时转为直接使用该分组的配置订阅中的链规则）。`seed <文件> <用户名>` 把有归属的文档写到该用户名下；不指定用户时文档无归属，登录后看不到，只能通过订阅接口使用。旧种子可携带同一模板的多个版本；导入先解析旧订阅引用，再只保留当前模板。

## 与设计文档的差异

- 存储用 better-sqlite3 直接读写 JSON 文档，没有用 05 建议的 Drizzle ORM：文档结构仍在频繁变化，暂不需要关系模型。
- 模板草稿只保存在前端，服务端只保存当前内容；编辑时用 `validate` 接口即时校验。
- 2026-10-29 前端只向管理员展示一个模板入口；普通用户仍需通过现有只读模板接口在配置订阅向导中选择当前模板。服务端的模板读写权限未变，旧种子仍兼容。
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

使用系统资源缓存周期；失败延后同一周期重试；可手动更新。Git 操作有进程内串行队列、磁盘锁、120 秒超时和 32 MiB 输出上限；退出时取消并等待 Git 进程组。崩溃遗留锁在确认所属进程不存在后自动恢复。单个缓存目录不支持多个主机共享。删除仓库时删除其 Git 缓存，但保留已导入规则集。缓存不是用户配置备份：成功索引后自动更新保护引用并回收不可达旧对象，失败保留旧索引可读提交。

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

策略组空组策略固定为 REJECT：服务端渲染自动补静态拒绝成员并写入 `empty-fallback: REJECT`，旧的 `whenEmpty: direct` 不再生效，无需迁移或客户端手工设置；最低 Mihomo 版本仍为 v1.19.27。

2026-10-29 规则集前端移除整组 no-resolve 配置入口及列表列；接口继续接受并保留 `noResolve`，历史设置的保存、预览和渲染行为不变，无需迁移，示例种子无需调整。

### 订阅源固定拉取设置（2026-10-29）

SQLite v15 清除订阅源旧 UA / 超时，只保留 `fetch.ttlSec`，保留文档归属和更新时间；订阅源历史压缩为最近一次成功及最新失败状态。规则集拉取设置和历史不受影响。服务层对正式拉取、草稿预览都强制使用默认 UA 与 10 秒超时，旧种子与保存接口也会规范化。节点只能内联输出或由本服务 `/p/…` 托管，不提供节点订阅地址透传；规则集仍按既有条件决定原格式透传或托管。


2026-10-29 规则转换：合并预览及实际订阅资源对 mihomo wildcard 按小写键去重，保留首条原文；存在重复 wildcard 的远程文本和 YAML 自动返回托管资源，下载与合并预览一致。单来源原文预览仍保留全部行，接口及保存数据无需迁移。


2026-10-29：订阅私有规则、规则集改写和模板发布均接受 `{ type: "RAW", text: "完整匹配原文" }`，client 可省略，旧客户端专用 RAW 继续兼容。接口校验空白 / 多行 RAW；未知单行规则类型可原样保存。出口仍由 RuleEntry.target 配置，no-resolve / src 由输出层置于出口后。种子改写示例采用 RAW，既有 demo 单条规则保留原表示；旧 IR 编辑后写 RAW，无批量数据迁移。

## 模板关系与旧数据升级（数据库 v16）

新订阅保存 `routing.mode = bound | independent` 与空 `overlay`。绑定保存模板 ID、`groupAdditions` 与可选前置规则，不需要版本号；独立保存完整 groups/rules/final，初始化来源仅作说明。旧的 template/overlay 创建请求与种子会自动转换，新模式 PUT 不允许回退为旧形状。

- `POST /api/profiles/routing/convert`：`{ profile, mode, templateId?, mapping? }`。只返回 `{ item, changes }` 草稿；mapping 以旧组 ID 映射目标 ID，null 表示明确不迁移。应用后通过原 PUT 保存，后保存的内容覆盖当前内容。
- `GET /api/profiles/:id/migration-backup`：仅订阅所有者可读，返回 `{ item: 原始文档 }`；备份在库内加密，删除订阅时一并删除。
- 模板 impact/publish 仅影响绑定订阅。组改名保留成员；删组和合并环等冲突不能强制发布。保存不因模板或订阅在检查期间更新而中断。

升级前先停止写入并保留完整数据库一致性备份及原密钥（运行中的 SQLite 使用 backup API，不能只复制主文件遗漏 WAL）。可在现有库上执行只读预检：

```bash
SUBFORGE_DB=/绝对路径/sub-forge.db pnpm --filter @sub-forge/server exec tsx src/cli.ts profile-migration-plan
```

预检读取数据库旁 `secret.key` 或现有 `SUBFORGE_SECRET`，不会生成新密钥、修改源库或输出完整配置。它在临时一致性副本上执行迁移并清理副本；任何失败均报错退出。审核清单后启动新版服务，数据库自动在事务内升级到 v16。纯追加、跟随最新且无诊断的旧订阅继续绑定；其他配置完整展开为独立模式，原始文档另外加密保存。

订阅 ID、归属、链接、基础设置、节点源、代理链及 last-good/版本资源保留；迁移前后有效分流配置必须一致。历史孤儿项原本不生效，留在备份与诊断中。缺失模板版本或旧合并错误会中止整批迁移，不能靠丢弃配置继续启动；修复旧库后再试。回退旧程序应恢复升级前整库及对应密钥，单份 Profile 备份不等于数据库降级工具。

示例种子保留原 `demo` 的筛选配置及 `demo-token`，将其完整展开为独立模式；另有 `demo-bound` / `demo-bound-token` 演示纯成员绑定。


绑定订阅的 `routing.prependRules` 可选，保存与草稿预览只接受单条规则，检查规则内容、出口归属与节点集成员。模板发布检查前置引用，引用组删除或规则 ID 冲突不允许 force；转换为独立配置保留前置规则，重新绑定显式映射组出口。现有绑定订阅无新增迁移。内置浏览器隔离验收入口：`pnpm exec tsx test/manual-prepend-rules-server.ts`，结束后用 SIGINT/SIGTERM 关闭。


### 规则存在即生效（SQLite v17）

保存、自检、预览及发布共用规则清理：旧 enabled:false 条目移除，其余清除标记。v17 在事务中处理规则集、模板全部版本、独立订阅与绑定前置规则，保持有效输出、归属、更新时间、链接和历史资源。旧种子导入执行同一清理，旧备份不修改。示例移除默认停用的 YAML/仓库来源。隔离浏览器入口为 `pnpm exec tsx test/manual-rule-presence-server.ts`，完成后关闭服务。


2026-10-29 绑定规则页的说明与间距修正仅调整前端呈现，无服务端、数据库或种子变更。

规则转换支持 `USER-AGENT`：来源读取计为已解析，POST 预览与 GET 下载对 Surge 输出有效规则，mihomo 保留客户端不支持注释；全部没有有效输出时 GET 仍返回 400。

Stash：/sub/:token?target=stash&platform=ios 或 macos 输出完整订阅；UA 可自动识别。预览接口接受 client: stash，并返回可独立导入的 exportYaml。资源和历史版本按客户端/平台隔离；Mihomo 校验器不用于 Stash。预设 stash 与 base.stashPatch 独立保存，节点按快照内联。详见 docs/17-official-client-configuration-guides.md。

### 2026-10-29：目录级联索引

> 2026-10-29：本节目录树／逐层加载方案已被本文末尾的「规则来源平铺分页」替代；保留历史决策，当前不显示文件夹。

SQLite v18 新增平面目录缓存 `rule_repo_catalog`，与条目、配置和提交同事务更新。仅记录扫描范围内目录及 list/txt；YAML、二进制、README.md 等不进入该缓存。目录由 Git 普通文件路径提取，符号链接与子模块沿用现有排除规则。原 include/exclude 和格式配置继续控制文件能否关联。缺少新缓存的旧仓库会在同提交下补建；更新失败保留旧目录，接口明确提示目录未完整。

`GET /api/rule-options/catalog?scope=all|repository` 只返回当前用户可见本地规则集、启用仓库的平面节点，由前端组装目录。`POST /api/rule-options/resolve` 新选项携带 `file:{ref,path}`，仅关联该文件；旧无 file 请求保留兼容。目录读取不访问上游正文，创建/引用前重新校验文件成员资格。删除仓库时一并删除目录缓存。

### 2026-10-29：全量名称筛选

仓库目录接口支持 `q`，使用规范化后的 SQL LIKE 与转义参数筛选；匹配路径由前端恢复父级目录。加密文档仍在授权读取解密后执行等价的包含筛选，再分页。`GET /api/nodesets/:type/:id/nodes?q=...` 在完整已处理节点集筛选后截取响应上限，`total` 为筛选后的数量。`%`、`_` 和反斜线按字面匹配，不当作用户通配符。

### 2026-10-29：仓库单文件正文预览

`GET /api/rule-repos/file-preview?repo&ref&path` 只读取所选 list/txt 原文，按目录索引校验成员资格并使用索引 commit；响应含 content、name、entry（可关联时）、ref、path、url、upstream、license。仅登录用户可用；目录或伪造文件返回 400，停用仓库返回 404，上游读取异常返回 502，可重试。空文件、纯注释与无有效规则文本仍能预览；创建操作另行执行既有解析校验。预览不组合文件，不请求 README，也不写本地规则集。


### 模板直接保存（数据库 v19）

模板不再有发布流程和历史记录。创建使用 `POST /api/templates`，更新使用 `PUT /api/templates/:id`；保存完成模板自检与绑定订阅影响检查后立即生效。绑定订阅仍跟随模板，独立配置不受影响。模板不维护递增版本号，不提供历史查看、对比或回滚；渲染缓存根据完整配置内容计算，订阅产物历史资源及 last-good 回退不受影响。

v19 在事务中先展开仍引用旧模板版本的遗留订阅并保存原始备份，再为每个模板保留当前内容、移除旧记录和 changelog。已采用 bound 模式的订阅保持绑定；更新保留订阅归属、更新时间和链接。旧种子导入执行相同顺序，缺失所引用历史时整批失败。升级前沿用上文完整数据库及密钥备份要求。

`GET /api/templates/:id` 只返回 `item`，历史版本读取接口已移除。旧 publish / impact 路径仅兼容旧调用，前端不再使用。


### 移除模板与订阅并发拦截（数据库 v20）

模板保存、订阅保存及绑定模式转换不再比较版本或修订号，也不再检查校验期间的数据变化。旧草稿、无版本请求均按最后一次完成的保存生效。模板 `version`、订阅 `revision` / `templateVersion` 不再产生、传递或持久化；旧请求带这些字段时忽略。

v20 清理旧记录中的并发字段，保留配置内容、绑定关系、归属、更新时间、订阅链接与原始迁移备份。旧种子先按原版本解析锁定引用，再清除编号；旧表的版本列只保留固定存储键，不参与运行时版本管理。页面未保存提醒、字段校验、权限与绑定内容冲突校验继续生效。

### 2026-10-29：目录分页接口（替代全量清单响应）

> 2026-10-29：本节目录树／逐层加载方案已被本文末尾的「规则来源平铺分页」替代；保留历史决策，当前不显示文件夹。

`GET /api/rule-options/catalog?scope=all|repository&q=&offset=0&limit=30` 返回 `{items,total,offset,limit,nextOffset?,notices}`。不传 `repo` 返回本地规则与仓库入口；传 `repo`、可选 `directory`（相对仓库根）仅返回当前层。默认每页 30 项，上限 100。SQL 先在完整索引搜索，按完整原始路径列出当前层，再稳定排序和分页，文件按完整路径与分支区分。缺失目录缓存时回退旧条目且同样分页并提示；不传分页参数也不会返回全量文件。数据模型和示例种子无需迁移。

## 2026-10-29：规则来源平铺分页

当前接口：`GET /api/rule-options/search?scope=all|repository&q=&offset=0&limit=30`，默认 30、上限 100，返回 `{items,total,offset,limit,nextOffset?,notices}`。items 包含 value（JSON 编码的 local 或 repository 单文件选择）、label（文件名）、hint（仓库名 · 原始路径 · 分支）、disabled。本地候选先按权限读取；仓库文件和本地候选统一由 SQLite 筛选、排序、分页。缺失缓存时从已有文件变体在 SQL 中回退，不在应用层读取全部文件。

移除 `/rule-options/catalog` 及目录树查询；新文件缓存不再生成目录节点，兼容旧缓存并在下次更新替换。正文预览只查询所选文件。单文件 resolve、历史引用和种子格式不变。隔离浏览器验收：`pnpm exec tsx test/manual-rule-options-server.ts`，使用内存数据和模拟 Git，结束后停止该进程。

2026-10-29：`/api/rule-options/search` 的仓库文件搜索仅匹配完整 path（包含文件名），仓库名与分支仅展示，不参与匹配。可避免 `ai` 命中仓库名 `domain` 导致整库出现；分页、大小写规范化、权限与文件身份保持不变。

2026-10-29：规则候选 hint 只显示父目录（根目录 `/`）与仓库／分支说明，完整 path 仍保存在 value。新增 `matches:{label:[{start,end}],hint:[{start,end}]}`，为对应显示字符串的 UTF-16 半开区间；只对本页实际搜索字段生成高亮，兼容 NFKC、大小写和跨目录／文件名匹配，不高亮仓库名与分支。

2026-10-29：候选 hint 默认为仓库名和可选父目录，根目录不输出 `/`。SQL 对当前完整匹配集按 repo 统计不同 ref，存在多分支时才显示 `repo name * branch * path`；不同仓库不混算。分页后只格式化当前页说明并更新高亮区间，不改变文件选择值。

模板规则原文预览：`POST /api/rules/matcher-source` 接收 `{ matcher }` 规则集引用，校验登录、引用映射及本地规则集可见性后返回 `{ name, content, sources }`。完整保留原文，多来源按保存顺序以换行拼接，不应用客户端转换、去重或改写；读取失败不返回部分结果，二进制返回明确错误。


2026-10-30 表单占位调整：管理接口的数据格式及示例种子不变。中文 placeholder 只在前端显示，不作为文档值提交；可选配置清空后省略对应键，显式 false / 0 原样保存。沿用现有预设发布与订阅覆盖接口，无数据库迁移。

## 2026-10-30：统一资源缓存 API

- `GET/PUT /api/system`：管理员读取/设置 `resourceCacheTtlSec`（3600–31536000，3600 的整数倍），默认 86400。
- `GET /api/{sources,collections,rulesets,profiles}/:id/cache`：当前资源状态。
- `POST /api/{sources,collections,rulesets,profiles}/:id/refresh-cache`：返回 202 和任务；订阅递归所有生效依赖并重建配置。
- `GET /api/refresh-jobs/:id`：仅任务所有者可读；逐项结果与生成结果分开显示。
- `POST /api/rule-repos/file-refresh`：刷新已授权索引中的单个公开文件。
- `GET /api/system/resources`：管理员汇总资源及仓库索引状态。
- `GET /api/events`：登录用户 SSE 通知，不携带文档数据；具体读取仍校验权限。服务退出主动关闭流。

SQLite v21 移除旧独立 TTL/订阅 interval，裁剪成功快照为一份，增加系统设置和共享资源绑定；刷新任务保存 7 天，启动将未完成任务标为中断。最终渲染取消结果内存缓存；保留解析缓存、在途合并、last_good 与最多 32 个结构版本。旧版本资源用于客户端一致性，不属于上游原文历史。生产启动会运行资源和仓库调度器。

2026-10-30 刷新任务响应：`results` 自创建起包含全部去重资源，顺序固定；`state` 标记 `pending / running / done / interrupted`，`ok` 仅在拉取完成后出现。并发完成只更新对应索引，关闭或重启将未完成项标为中断。兼容旧任务缺少逐项 `state` 的已完成结果，无数据库迁移及示例种子变更。内置浏览器可通过 `pnpm --filter @sub-forge/server exec tsx test/manual-resource-refresh-server.ts` 启动独立内存验收服务，完成后必须停止。

仓库 list/txt 正文通过统一快照按需读取 raw URL，与已引用公开资源共享缓存；目录仍用 Git 索引，README 仍按索引提交读取。未被引用的文件不整库预抓取。正文预览失败且存在旧内容时继续使用旧内容。此前章节中的历史 TTL/透传设计以本节及领域模型第 7 节为准。

隔离验收：构建 web 后运行 `CACHE_TEST_CONTROL=/tmp/subforge-cache-control.json pnpm --filter @sub-forge/server exec tsx test/manual-resource-cache-server.ts`，控制文件为 `{"fail":false,"version":1}`。仅内存数据与虚构上游，结束须终止进程。验收记录在 `research/verification/unified-resource-cache-20261030/`。


2026-10-30 审查修复：草稿远程资源按用户隔离，递归引用及异步下发复核权限，授权失效不允许旧版本回退；渲染检查配置和成功/尝试快照修订，避免旧任务回写。MRS 必须实际拉取并校验二进制类型。已浏览的未引用仓库正文参与调度/异常汇总；换地址或删除后回收无其他引用的原文。新增 `test/cache-review.test.ts` 19 项，完整记录见 `research/verification/unified-resource-cache-review-20261030/`。

### 2026-10-30：统一规则卡片与本地多条

模板、独立订阅和绑定前置规则支持 Matcher.local，多行保存校验与输出共用 core 实现；数据库无需迁移。增强关联替换使用新来源 ID、原位置，仍校验仓库单文件身份。URL 匹配复用 `/api/rule-options/match-urls`，标记不落库，前端仅在新增、导入应用或手动检测时调用。示例种子的本地卡片已包含注释和两条规则。

隔离内置浏览器验收入口：先构建 web，再在本包执行 `pnpm exec tsx test/manual-rule-cards-server.ts`，使用内存数据库、虚构上游与模拟索引，端口 5237；结束发送 SIGINT 释放服务和临时资源。测试账户仅用于该隔离进程，详见验收记录。

2026-10-30 订阅弹窗整合继续复用 /profiles/routing/convert 生成草稿，最终保存才持久化。没有新增接口或种子迁移；填充、代理链及规则出口映射仍由服务端验证，相关 12 项测试通过。


2026-10-30 列表刷新时间：前端继续使用资源状态接口的 `items[].lastSuccessAt`（最近成功快照时间），失败时仅更新 `lastAttemptAt`，不覆盖成功时间。多资源列表展示最近成功时间，逐项失败状态仍独立显示。现有刷新测试补充失败回退后时间不变、节点成功后时间前进的验证；任务响应、数据库和示例种子不变。内存验收服务补充节点、组合和纯本地规则，覆盖主列表与节点刷新弹窗。


2026-10-30 处理链工作区：前端隐藏自动兜底步骤，仅显示显式处理器；服务端预览仍返回完整 trace 和最终去重结果，编辑保存接口不变。内存浏览器验收服务增加 3/80 节点与 4/20 步骤样例，验证参数保存、长内容滚动和布局；正式示例种子及数据库无需变化。


2026-10-30 单一状态列：订阅源主列表移除独立快照“状态”列，统一资源状态列改名为“状态”，只显示一份正常、刷新中、首次待拉取或失败及旧缓存状态。上次刷新时间仍位于操作列前；失败不覆盖成功时间。列表不再为重复状态额外请求快照历史，详情和总览所需的快照接口继续保留。服务端资源状态接口、核心模型与示例种子不变。

2026-10-30 图标隔离验收可给 manual-rule-cards-server.ts 增加 `--icons`，补充虚构组合、处理链和订阅链接。此次图标修正无服务端 API、数据库及生产示例种子变更；此前规则卡片实现随本次一并合并。

2026-10-30 编辑提示与焦点样式精简不改变 API、数据库和示例种子。


2026-10-30 合并补充：处理链输入输出表格左右各留 16px，与面板边框分开；保留独立滚动、等高双栏和统一步骤行高。整合主分支已有的规则卡片、按钮图标及编辑提示修改，文档冲突保留双方追加内容。此次间距调整不改变服务端接口、核心模型、数据库或示例种子。

2026-10-30 宽度更正：撤销订阅源详情的横向满宽要求，恢复公共页面的 1280px 最大宽度及响应式两侧间距，仅处理链与预览纵向填满剩余空间。等高双栏、独立滚动和表格左右 16px 留白保留；服务端接口、核心模型、数据库与示例种子无变更。
