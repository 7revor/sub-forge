# 资源入口、鉴权与生命周期

本契约以 SQLite v25 和查询参数路由为准。旧 `/sub`、`/p`、`/r`、`/rules`、`/nodes` 和 `/api/files` 入口全部移除，不重定向，不提供兼容分支。

## 三类入口、两种凭证

| 入口 | 凭证 | 权限 |
| --- | --- | --- |
| `/api/*` | `sf_session` 登录 Cookie | 后台查询、编辑、刷新和草稿预览；按业务检查用户或管理员权限 |
| `/subs/*` | `?token=当前用户资源令牌` | 私有订阅资源；token 有效、用户启用，且资源属于该用户 |
| `/resources/*` | 同一个用户资源令牌 | 公共规则增强、公共仓库及其转换产物，任意有效用户 token 可读 |
| `/auth/login`、`/auth/logout` | 建立或结束登录会话 | POST；与管理 API 分离 |

每用户只有一个资源 token，预览、复制链接、客户端订阅和配置内资源共用。资源 token 不能调用 `/api`；`/api` 即使有登录 Cookie 也拒绝 `token` 查询参数。文件入口不以 Cookie 补足缺失或无效的 token。用户重置 token 后全部旧凭证失效，资源身份和其他用户凭证不变；退出登录不撤销客户端资源 token。

所有 GET 动态值均放 query，固定路径表达资源类别。参数通过共享 `queryUrl` / `URLSearchParams` 编码，不手工拼接用户输入。重复单值参数拒绝；文件入口还拒绝未知或冲突参数。`token` 是凭证，`id/profile/rule/key` 是定位信息，`target/platform` 是输出选择，`version/revision/hash` 是一致性信息，不能互相替代。

## 文件接口

以下地址都支持 GET / HEAD。表中的 `T` 仅为 token 占位符。

| 地址 | 内容与边界 |
| --- | --- |
| `/subs/profile?id=P&token=T` | 本人完整配置；`target/platform` 优先于 UA，未知 UA 默认 Mihomo |
| `/subs/nodes?kind=source&id=N&token=T` | 本人节点源，`kind` 也可为 `collection`、`local`；整个依赖树检查归属 |
| `/subs/nodes?kind=provider&profile=P&id=K&target=mihomo&token=T` | 该配置的节点 provider；可带 `platform`，每次按当前配置生成 |
| `/subs/ruleset?profile=P&key=K&target=mihomo&token=T` | 该配置的专属规则产物；按目标与当前有效引用生成 |
| `/subs/ruleset?profile=P&rule=R&view=source&revision=H&token=T` | 该配置专属规则的来源原文；R 是已保存规则行 ID，H 为 matcher 摘要 |
| `/resources/ruleset?id=R&token=T` | 公共规则增强输出，支持 `target/platform`；`view=source` 查看启用来源原文，默认或 `view=output` 为转换结果 |
| `/resources/ruleset?key=K&token=T` | 固定客户端/平台/处理参数的公共增强产物，不接受额外目标或上游 URL |
| `/resources/repo?id=REPO&ref=分支&path=文件路径&token=T` | 启用仓库当前索引内的文件原文；不能指定任意上游 URL |
| `/resources/repo?id=REPO&files=JSON&token=T` | 多文件来源原文；JSON 为最多 50 个 `{ref,path}` 的数组，每个文件分别验证索引成员资格，不能同时传 ref/path |
| `/resources/repo?key=K&token=T` | 仓库引用对应的公共转换产物；仓库停用、删除或文件失效后不可读 |

节点 provider 的 `hash` 仅用于刷新客户端缓存；`version` 表示配置结构。公共规则的 `key` 是稳定 SHA-256 标识，包含规则身份、有效处理参数和客户端输出契约，不包含用户、token、订阅 ID 或出口组。公共规则只被一份订阅引用，也不会变成私有资源。

## 公共规则与订阅专属规则

公共规则增强定义和仓库文件属于公共资源。订阅只是引用它们，不复制一份私有公共规则。不同用户读取同一产物时，资源键相同，链接中的 token 不同。客户端格式、平台或 `src` 产生不同公共变体；指定不同出口组不会改变规则正文或归属。

订阅中直接填写的远程规则 URL 属于该订阅。模板中的直接远程引用应用到订阅后，也归该订阅鉴权。专属产物按当前配置生成，最近成功结果加密保存在 last_good 中，不进入公共资源表；原文按订阅作用域绑定，其他用户不能借相同 URL 或缓存取得访问权限。

模板本身没有 token 入口。管理页点击仓库或远程规则直接查看源 URL，点击增强引用进入增强详情的合并结果；未保存的远程地址也可直接查看。服务端保留登录态 `GET /api/templates/rule-file?id=模板ID&rule=规则行ID&revision=摘要` 用于已保存原文读取，未保存草稿的转换试算使用登录态 POST，不发行长期资源地址；结束后清理无归属缓存绑定。

## 复制链接与预览

配置订阅、节点源、组合、本地节点、规则增强及首页相关列表均使用当前登录用户 token 复制链接。`GET /api/resource-links?kind=类型&id=对象ID` 支持 sources、collections、locals、profiles、rulesets，校验归属和依赖，只生成链接，不预抓取上游。`GET /api/profiles/link?id=P` 返回本人配置链接。

规则仓库整行点击和名称悬停复制直接使用公共仓库 raw 地址；增强详情中的远程来源、模板和订阅中的仓库／远程规则同样直达源 URL，不附带本系统 token、不做缓存或转换。增强引用打开 `/rulesets/:id#preview` 的合并结果，可切换客户端；本地规则保留统一弹窗。详细交互见 [源文件预览约定](08-rule-repository-index.md#源文件预览与订阅输出2026-10-30)。

订阅节点来源及明确复制的订阅链接使用托管文件。服务端原文接口保留注释和空行，响应使用 `text/plain`、`Content-Disposition: inline`、`nosniff`、`no-store` 与 `Referrer-Policy: no-referrer`；这些响应约束不适用于浏览器直接访问的外部源站。MRS/SRS 不在内置原文弹窗展示；有效 MRS 的客户端托管下载仍支持二进制。

“来源原文”与“最终输出”是不同内容：原文不执行增强改写，公共增强复制链接返回转换后的结果。原文引用的 revision 只检查是否已保存，不参与鉴权；相关引用改变返回 409，删除或权限失效返回 404。无关文档编辑不打断原文读取。

## 托管、缓存与流量

实际订阅输出中的所有节点和规则均由服务端托管。节点先运行处理链，再由服务端把代理链写入匹配节点；Mihomo 不生成 provider 级 `override.dialer-proxy`。Mihomo 可输出节点 provider，Stash、Surge、Loon 的节点按客户端能力内联。

规则统一解析、增强、去重与客户端转换，不保留上游 URL 透传分支。不可表示的规则输出诊断。单一有效 MRS 校验后原字节托管，不能合并或改写；SRS 暂不支持。规则提供者优先使用增强名称，否则使用去后缀文件名，重名追加 `_2`、`_3` 后缀；显示名称不承担鉴权和资源定位。

公共原文按地址和有效拉取参数共享，私有节点按用户隔离，专属规则按订阅隔离。系统 TTL 默认 24 小时；后台最多 4 个并发拉取，未使用的仓库文件不预抓取。公共产物合并在途请求，输入摘要不变时复用转换结果。读取在鉴权之后进行，缓存存在不代表允许访问。

公共规则可独立更新，不重渲染主配置；私有规则每次请求按所属配置重新生成。来源失败可以使用仍有效的最后成功结果，并通过 `X-Sub-Forge-Warning` 标识；删除、停用或归属失效不能以成功缓存兜底。文本与 MRS 使用不同输出契约，旧文本地址不能收到二进制。

节点源、组合及节点 provider 的 GET / HEAD 保留上游 `Subscription-Userinfo` 的 upload、download、total、expire；缺失值不补零，零值保留。组合按唯一上游 URL 去重累加，到期取最早已知值。成功刷新无流量头时清除旧值，失败时保留最后成功快照的流量。节点筛选不改写套餐额度。

## 删除和在途请求

| 变化 | 处理 |
| --- | --- |
| 删除订阅 | 主配置、节点 provider、专属规则失效；删除成功配置、迁移备份、刷新任务和无引用私有原文；不删除独立节点、用户 token 或公共规则 |
| 删除/替换订阅专属规则，或模板移除该引用 | 清除含失效专属规则的历史产物和原文绑定；旧地址不可读 |
| 删除公共规则增强 | 被引用时管理接口返回 409；删除后清理所有公共变体和最后一个原文绑定 |
| 停用/删除仓库或移除索引文件 | 对应文件与转换产物不可读，清理失效产物和正文绑定；保留有效的其他资源 |
| 删除管理员可清理的公共产物 | 仍被引用时拒绝；不删除公共定义，未来使用可以重新生成 |
| 重置 token、禁用用户 | 请求开始和返回前复核；无效 token 不返回正文或流量头 |
| 删除并重建同 ID | 删除通知取消旧请求的下发资格，不能把旧请求算作新资源的读取 |
| 模板预览期间登录失效 | 返回 401，不下发先前登录会话读取的正文 |

配置节点和专属规则直接返回当前生成结果，不保存结构版本历史。资源最后一个绑定消失后清理原文；晚到的上游响应不恢复无绑定缓存；排队原文请求在删除后才开始读取时，也在结束前清除晚建的失效绑定。仓库停用后立即重新启用不会恢复旧请求的下发资格或缓存绑定。请求结束释放删除监听器，后台刷新停止时等待在途任务结束。

访问日志只保存资源身份、访问者和结果，不保存带 token 的完整 URL。部署反向代理时也应对 token 参数脱敏。

## 管理 GET 与升级

管理 GET 使用固定路径加查询参数：

- 列表 `/api/profiles`，详情 `/api/profiles?id=P`；sources、collections、locals、rulesets、presets、templates 同理。
- `/api/nodesets/nodes?type=source&id=N`、`/api/sources/snapshots?id=N`。
- `/api/profiles/access-log?id=P`、`/api/profiles/migration-backup?id=P`。
- `/api/{sources|collections|rulesets|profiles}/cache?id=ID`、`/api/refresh-jobs?id=JOB`。
- `/api/rulesets/sources/content?id=R&source=S`。
- `/api/me/token`、`POST /api/me/token/reset`；重置 body 仍携带当前 `{token}`，防止过期操作覆盖新凭证。

写操作的业务内容继续放 JSON body，现有 POST/PUT/PATCH/DELETE 的对象路径不属于 GET 迁移。

v25 在事务中清空含旧链接的 last-good 和结构版本，移除曾错误作为公共产物保存的直接远程规则，清理失效绑定。保留用户当前 token、配置、节点、模板及公共定义。若从 v22 或更早升级，仍先执行 v23 的单订阅 token 撤销迁移，不能扩大旧凭证权限。

这是不兼容的地址迁移：所有客户端必须重新复制主订阅/独立资源链接，刷新主订阅后取得新 provider 地址。旧地址一律停止服务，不保留任何 URL 重写或兼容下载入口。

验证记录见 [查询参数资源入口验收](../research/verification/query-resource-routes-20261030/README.md)。

2026-10-30：v27 移除资源地址的 `version`、`hash` 参数及结构版本历史表，清空含旧参数的 last_good。配置、用户令牌和上游快照保留；升级后刷新完整主订阅取得新资源地址。旧参数不再接受，节点和专属规则直接按当前配置生成，生成失败仍可使用有效的最近成功结果。

## Loon 手写规则托管

Loon 手写规则、仓库引用、远程引用及增强引用全部按列表顺序输出 `[Remote Rule]`，`[Rule]` 只保留 `FINAL`。手写规则经客户端改写后以每个列表项为单位存入订阅私有正文，复用 `/subs/ruleset?profile=P&key=K&target=loon&platform=…&token=T`；不进入公共资源表。现有所有者和令牌检查继续生效，移除、禁用或修改匹配定义后清理失效私有产物。公共仓库和增强规则保持现有 `/resources/repo`、`/resources/ruleset` 边界。
