# 上游缓存分层重构计划

状态：已完成（2026-11-03）。制定日期：2026-11-02。实际提交和验收结果见第 11 节。

本文是自包含的实施计划，新对话只读本文和 `CLAUDE.md`、`AGENTS.md` 就能继续，不依赖此前的对话记录。对话中做出的决定和被否决的方案都记录在第 2、9 节。

## 1. 从哪里开始

| 项 | 值 |
|---|---|
| 工作目录 | 从 `main` 新建 worktree：`.claude/worktrees/upstream-cache-refactor` |
| 分支 | `refactor/upstream-cache-layering` |
| 基线 | `main`。懒加载、定时清理和明文存储已合并（`2284c50`） |
| 结构版本 | `main` 是 v35。**如果 v35 还没有部署到任何环境**，可以继续扩展 v35；**一旦已部署，必须新增 v36**，否则已升级的库不会执行新迁移。开始前先向用户确认 |
| 已落地 | 见第 3 节 |

开始前执行：

```bash
git worktree add -b refactor/upstream-cache-layering .claude/worktrees/upstream-cache-refactor main
cd .claude/worktrees/upstream-cache-refactor
pnpm install --offline --frozen-lockfile
```

三个包的基线测试应全部通过：core 756、server 694、web 361（`2284c50` 上的结果，只要求没有失败）。

## 2. 目标模型（用户已确认）

**缓存只存在于上游，下游全是纯函数。每一层只调用上一层的接口，不关心上游的内容是缓存还是实时读取的。**

| 层 | 资源 | 是否缓存 | 取数方式 |
|---|---|---|---|
| 上游 | 节点订阅 | 有，永不清理 | 见 2.2 |
| 上游 | 规则仓库文件、远端规则 URL | 有，到期立刻失效 | 见 2.3 |
| 上游（不算内容缓存） | 仓库索引表、Git 裸仓库 | 不清理 | **后台定时任务**：跟随全局周期（24 小时即每天 0 点）自动同步 Git 和文件目录，不依赖请求，不下载规则文件内容，见 2.5 |
| 中间 | 本地节点 | 无 | 直接读库 |
| 中间 | 节点组合 | 无 | 实时计算，成员调用上游接口 |
| 中间 | 自定义规则集合 | 无 | 实时计算；静态内容读库，远程和仓库来源调用上游接口 |
| 下游 | 模板、配置订阅 | 无 | 实时计算，只写地址或调用上游接口 |

文档（配置、模板、规则集、订阅源、组合、本地节点）永久保存，不属于缓存。

### 2.1 全局缓存周期

- 没有“每个资源一个 TTL”。系统只有一个周期，沿用现有设置 `resourceCacheTtlSec`（界面“每 N 小时”，1 至 8760 的整数小时）。
- 判定：**快照的拉取时间早于当前周期开始时间，就算过期。**
- 周期按服务器本地时间 0 点对齐。24 小时就是每天 0 点。放在新文件 `packages/server/src/cache-cycle.ts`：

```ts
/** 按服务器本地时区对齐：24 小时周期落在每天 0 点。 */
export function cacheCycleStart(now: number, ttlSec: number): number {
  const ttl = ttlSec * 1000;
  const offset = new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor((now - offset) / ttl) * ttl + offset;
}
```

- 下次失效时间是 `cacheCycleStart(now, ttl) + ttl`。修改周期设置后立即按新周期判定，部分缓存可能提前失效，这是预期行为。
- 容器默认时区是 UTC，需要在部署文档说明可用 `TZ` 调整。
- 客户端更新间隔（`profile-update-interval`、provider `interval`、`#!MANAGED-CONFIG interval`）继续直接取 `resourceCacheTtlSec`。

### 2.2 节点订阅

| 情况 | 处理 |
|---|---|
| 本周期内已成功拉取 | 用缓存 |
| 到了新周期 | 下次请求时读源，最多等 3 秒（`STALE_WAIT_MS`），超时先返回旧数据，刷新在后台完成 |
| 读源成功 | 替换旧数据 |
| 读源失败（超时、报错、内容不合规），有旧数据 | 用旧数据并告警，**本周期不再重试**，下个周期再试 |
| 读源失败，从未成功 | 返回错误，**不按周期退避**，下次请求重试；保留一条失败记录供“资源异常”显示 |
| 手动刷新 | 立即读源，其他同上 |

节点快照永不按时间清理，始终保留一份有效副本。只有删除订阅源或修改其 URL 时才移除。

### 2.3 规则快照（仓库文件、远端规则、规则集合的远程来源）

| 情况 | 处理 |
|---|---|
| 本周期内已成功拉取 | 用缓存 |
| 到了新周期 | 立刻失效，不再当旧数据使用，不管有没有引用 |
| 已过期或从未拉取 | 读源并等待，最多到上游超时（10 秒） |
| 读源成功 | 写入缓存 |
| 读源失败 | 返回错误，**失败不写入缓存**，下次请求重试，没有退避 |
| 手动刷新 | 立即读源；失败时保留本周期仍有效的快照，并在任务结果中报告 |

规则没有“旧数据兜底”，所以规则的 3 秒限时等待和 `x-sub-forge-warning: last-good-rule` 都要移除。

### 2.4 主配置

下发主配置**不读规则源，也不读规则快照**，只从数据库读规则定义，确定 provider 名称和格式，然后写入规则地址（坐标）。规则内容由客户端另行请求。节点快照仍要读，因为策略组筛选和代理链需要节点名，流量信息头也来自节点快照。

### 2.5 仓库的 Git 和文件目录索引

| 情况 | 处理 |
|---|---|
| 到了新周期 | 后台定时任务自动同步，不等请求。周期和节点、规则共用，24 小时周期就是每天本地 0 点 |
| 服务在周期切换时没运行 | 启动时补做一次 |
| 同步失败，已有索引 | 保留旧索引，显示在“资源异常”，下个周期再试 |
| 同步失败，从未成功 | 不自动重试，下个周期再试，或使用手动同步入口 |
| 手动刷新 | 立即同步 |

定时任务只同步目录，不下载规则文件内容，也不会预热规则快照。

## 3. `main` 已完成的工作（不要重做）

| 提交 | 内容 |
|---|---|
| `0c4b8e9` 等 | 删除 `last_good`、`shared_rule_resources`；公共规则改为自描述地址 `/resources/ruleset?id&target&format[&behavior][&src]` 和 `/resources/repo?id&files&target&format…`；主配置用 `deferRuleBody` 跳过规则转换；旧 `?key=` 返回 404 |
| `223f571` | 懒加载：`SnapshotService.get` 限时等待；节点并行拉取；`latestSnapshotMeta` 不读正文；主配置不拉规则 |
| `95acd04` | 去掉后台拉取；`ResourceService.sweep` 只清理；`RuleRepoService.refreshIfDue` |
| `8df02b0` | v35：文档、迁移备份、快照、刷新任务、令牌原文改明文，`token_enc` 改名 `token`，数据库文件 0600；`Store.legacyEncoded` 只在升级时为真 |
| `e4d5aeb`、`7a908e7` | 文档和前端文案（部分描述会被本计划替换） |
| `978c77e` | `RuleRepoService.start()` 只开启按需同步，避免测试访问真实 Git。**这里的按需同步是过渡实现，本次重构要改掉，见 5.3** |

加密保留范围（已实现，不要改）：用户密码 scrypt、令牌和 URL 的 HMAC 索引、会话哈希、系统设置里的备份凭据、WebDAV 备份文件。

## 4. 代码现状与目标的差距

1. **`resource_bindings` 让上游关心下游。** 到期一律清理后不再需要引用计数。整张表及 `bindResource`、`resourceBinding`、`pruneResourceBindings`、`pruneUnusedResource`、`dropResourceBindings`、`pruneStaleBindings`、`snapshotOwner` 都可以删除。
2. **同一 URL 存多份。** `ruleBinding`（`rule-binding.ts`）把 `profile:`、`template:`、`public-rules` 作用域混进缓存键。实测 1 个模板、3 个绑定订阅和 1 个增强引用同一 URL 时，存 5 份、拉 5 次。
3. **规则文件依赖节点。** `/subs/ruleset`（`resource-files.ts`）调用 `renderer.render(profileId, output, key)`，要渲染整个配置，节点订阅失败时规则也失败。
4. **过期判定按资源计时。** `snapshots.ts` 的 `status` 用 `attempt.fetchedAt + ttl`，要改成全局周期。
5. **规则失败被缓存。** `refresh` 对规则写失败行，退避一个周期。
6. **清理按引用判断。** `resources.ts` 的 `liveResources`、`sweep` 要简化。
7. **`repository-file:`、`repo-read:` 这类下游身份。** `rule-repos/service.ts` 的 `readFile`、`filePreview`、`fileResource`、`ruleSetFromFiles`、`cachedResources` 依赖它们。
8. **仓库索引是按需同步。** 现在由 `refreshIfDue` 在读取目录、搜索和读取仓库规则时触发，到期按每个仓库的 `checked_at` 计时。目标是后台定时任务，并按全局周期判定。

## 5. 详细改动

### 5.1 快照存储

继续用 `snapshots` 表，身份分两类：

| 类型 | `owner_kind` | `owner_id` | 行数 |
|---|---|---|---|
| 节点 | `source` | 订阅源 ID | 最多 1 条成功 + 1 条最新失败 |
| 规则 | `ruleset` | `cipher.hmac(JSON.stringify([url, { ua, timeoutMs, format, behavior }]))`，即“URL 加读取参数” | 最多 1 条成功，没有失败行 |

规则缓存键不含任何用户、配置、模板或规则集 ID。读取权限在入口校验（`/resources/*` 校验令牌，`/subs/ruleset` 校验配置归属），不靠缓存隔离。`behavior` 只在 `format === 'mrs'` 时进入键，和现有 `SnapshotService.options` 一致。

`Store` 提供两组窄接口，替换现有 `resource` 相关方法。具体命名可调整：

- 节点：按 `sourceId` 读最新成功、最新尝试；写入；`deleteSourceSnapshots(sourceId)`。
- 规则：按缓存键读成功快照；写入；`deleteExpiredRuleSnapshots(cycleStart)`。
- 保留 `latestSnapshotMeta` 的思路：只判断新旧时不读 `body`。

文档变更时：删除订阅源或修改其 URL，同步删除该订阅源的快照。规则定义变更不用处理快照。

**晚到响应：** 节点拉取结束写入前，确认订阅源还在且 URL 未变，否则丢弃。规则响应可以写入，到期自然失效；下发前由调用方复核定义（`shared-rules.ts` 已有 `cancelled`、`definition()` 复核）。

### 5.2 上游接口（`snapshots.ts`）

拆成两个清晰的入口，下游只调用这些：

```ts
getNodeSource(source: SourceDoc): Promise<{ snapshot?; stale: boolean; error?: string }>
getRuleContent(url: string, params: RuleFetchParams): Promise<{ body: string; fetchedAt: number }> // 失败时 throw
refreshNodeSource(source) / refreshRuleContent(url, params) // 手动刷新
```

- 合并相同身份的在途请求（已有 `inflight`）。
- 新增进程内并发上限 8，节点和规则共用，排队不影响合并。周期切换后客户端可能同时请求几十个规则文件。
- 校验逻辑保留：`unusableBody`、MRS 校验、SRS 拒绝。
- `rule-binding.ts` 删除。`api/templates.ts:70`、`rule-source.ts:27`、`render.ts:230`、`shared-rules.ts:45`、`rule-repos/service.ts:305`、`resources.ts:52` 改为调用规则接口。

### 5.3 下游调用方

- **`render.ts`**
  - 主配置 `deferRuleBody` 恒为真（非预览时）。删除 `opts.ruleKey`、`neededRules`、`requestedRule`、`StoredRender.ruleBody`。
  - 预览（`dry`）仍需要全部正文，规则来源改成并行拉取，现在是逐个 `await`。
  - `checkCurrent` 和 `revision` 中对规则快照的跟踪可以简化：规则不再有旧数据竞争。节点仍需检查。
- **`resource-files.ts`，`/subs/ruleset`**：不再调用 `renderer.render`。校验令牌和配置归属后，用 `resolveProfileRouting` 取当前规则，按 `ruleKey` 找到规则，再调用转换服务。找不到返回 404，上游失败返回 503。
- **`shared-rules.ts`**
  - 去掉 `if (reference.matcher.remote) return undefined`，让它也服务专属远端规则。入口权限由路由负责。
  - 支持 `matcher.kind` 为 `rule`、`local` 的引用（Loon 手写规则走 `/subs/ruleset`，没有 `RuleSetDoc`）。
  - 来源通过 `getRuleContent` 取，失败直接抛错。`SharedRuleOutput.stale` 删除。
- **`rule-repos/service.ts`**
  - `readFile`、`filePreview`、`ruleSetFromFiles` 用规则接口，删除 `repository-file:`、`repo-read:` 身份和 `cachedResources`。
  - 仓库的 Git 和文件目录索引改为**后台定时任务**：`start()` 启动定时器，每 60 秒检查，`checked_at === null` 或 `checked_at < cacheCycleStart(...)` 的启用仓库自动同步；服务启动时补做一次；`stop()` 清除定时器。
  - 删除 `refreshIfDue`，以及 `api/rule-options.ts`、`api/rule-repos.ts`、`resource-files.ts` 中的调用，读取目录和规则文件不再触发同步。
  - 同步只做 `git fetch --filter=blob:none` 和 `ls-tree`，不下载规则文件内容；内容按 2.3 在请求时读取。
  - `api/index.ts` 的 `setAdditionalResources` 和 `resources.ts` 对应逻辑删除。
- **`resources.ts`**
  - `sweep` 只做两件事：`deleteExpiredRuleSnapshots(cycleStart)`、删除 7 天前的刷新任务。删除 `liveResources`。
  - `start` 继续每 60 秒检查，跨过周期边界才清理；启动时补做一次。读取路径也按周期判定，所以清理延迟不影响下发。
  - `all()`、`statuses()` 只列节点订阅和仓库索引；规则失败不进“资源异常”。手动刷新配置时仍可刷新其规则，结果写入任务。

### 5.4 迁移（`store-migrations.ts`，版本见第 1 节）

在 `decryptStoredData` 之后执行（新增 v36 时作为独立步骤）：

1. 用 `resource_bindings` 把节点快照的 `owner_id` 从 `resource:…` 改回订阅源 ID。多个订阅源绑定同一资源时，为每个复制一份。无法对应的节点快照删除。
2. 删除全部 `owner_kind = 'ruleset'` 的快照（可重建）。
3. `DROP TABLE IF EXISTS resource_bindings`，并从 `schema.ts` 移除表和索引。

历史步骤注意事项：

- 第 164、177 行调用 `pruneResourceBindings(this.legacyTemplates)`，方法删除后这两处直接删除。
- `promoteRuleOverrides`（约第 243 行）和 `api/validate.ts:271` 用 `store.latestSnapshot('ruleset', ruleset id, url)` 取旧快照来换算行号。迁移里改用原始 SQL 按旧 `owner_id` 读取，并兼容“没有内容，保留可重试”的现有语义。`validate.ts` 里的旧行号改写要确认：快照可能已被清理，此时应走现有“无内容来源”分支，并用测试覆盖。
- 升级时可能经过旧版本的快照行，不要依赖新的缓存键格式。

### 5.5 前端与设计稿

- `GET /api/system` 增加 `nextCacheExpiryAt`，系统页显示“下次缓存失效时间”。
- `components/ResourceCache.tsx`：规则资源没有快照是正常状态，不能用警告色，也不能写“待首次拉取”。可用“使用时拉取”的中性徽标。节点保持现状。悬停文案去掉逐个资源的“下次拉取”。
- `pages/System.tsx`：`资源异常` 只显示节点和仓库索引；文案改为周期语义。
- `pages/Sources.tsx`、`SourceFetchStatus.tsx`：改为“新周期后下次使用时重新拉取；失败时继续使用旧内容，下个周期再试”。
- 规则集合详情和仓库预览：错误文案不能再写“正在显示上次成功内容”。检查 `docs/11-design-coverage.md` 第 235 行提到的琥珀色文案对应的组件。
- 访问日志 `AccessLogCard` 的 `last-good` 标签保留，用于历史记录和节点告警。
- **设计稿** [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)：v2「系统 / 用户 / 账户」（`project/V2Settings.dc.html`）的“资源缓存”“资源异常”文案和示例数据要与前端一致。发布方法是读取文件、本地编辑、用 Artifact 工具带 `url`、`root`、`file_path` 发布；如果 `edits` 参数被文件编辑钩子拒绝，就先改文件再发布。

遵守 `CLAUDE.md` 的三处同步规则：设计稿、前端、后端同一任务改完，缺一处不算完成。

### 5.6 文档

- `docs/02-PRD.md`：修订 SRC-02、OUT-04、OUT-05、PRF-06、数据保留，注明日期和替代方案，不删条目。新增“节点 / 规则两种缓存语义”。
- `docs/03-domain-model-and-pipeline.md`：删除 `resource_bindings`，更新第 496 行附近的资源身份说明，记录 `cacheCycleStart`。
- `docs/05-roadmap-and-open-questions.md`：更新实现状态。
- `docs/11-design-coverage.md`：记录画板改动。
- `docs/19-managed-resources.md`：更新托管、缓存、删除表格和“懒加载与清理”一节。
- `docs/19-client-conversion.md`：更新失败语义。
- `docs/20-deployment-client-ip.md`：说明 `TZ`。
- `docs/22-database-backup.md`：备份不含已清理的规则快照。
- `packages/server/README.md`、`packages/web/README.md`、`packages/core/README.md`。
- 本文：完成后把状态改为“已完成”，并记录实际提交。
- `docs/` 以外的历史验证记录保持原样。

### 5.7 其他

- `.gitignore` 增加 `packages/server/data/`。之前测试触发真实 Git 同步，产物曾被 `git add -A` 误提交。提交前检查 `git status`，不要提交 `packages/server/data`。
- 不改动 `/subs/nodes?kind=provider`。它要靠完整配置的代理链结果算出，仍渲染整个配置。

## 6. 建议的提交顺序

每个提交语义完整、可独立回退，每步都跑相关测试。类型前缀英文，正文中文，结尾带 `Co-Authored-By`。

1. `refactor`：引入 `cacheCycleStart`，节点和规则按全局周期判定过期。
2. `refactor`：拆分节点和规则的上游接口，规则失败不写缓存，到期不再当旧数据；移除规则的限时等待和告警头。
3. `refactor`：规则缓存键改为“URL 加读取参数”，删除 `resource_bindings`、`ruleBinding` 和相关身份，补充迁移。
4. `refactor`：`/subs/ruleset` 不再渲染配置；预览规则并行；加全局并发上限。
5. `refactor`：`sweep` 改为按周期删除规则快照；仓库索引改为后台定时任务并按周期判定到期，删除 `refreshIfDue`。
6. `feat`：系统页显示下次缓存失效时间，调整规则资源状态显示，同步设计稿。
7. `docs`：同步全部文档，并把本文状态改为已完成。

## 7. 测试要点

需要改写的现有测试（断言引用了绑定、作用域或旧语义）：`cache-review`、`file-links`、`lazy-fetch`、`managed-resources`、`prune-resource-bindings`、`query-boundaries`、`resource-boundaries`、`rule-file-preview`、`snapshot-status-readonly`、`resource-refresh`、`ruleset-snapshots`、`ruleset-preview-recovery`。

需要新增的用例：

- `cacheCycleStart`：24 小时对齐本地 0 点；1 小时；N 不整除 24；边界前后 1 毫秒。
- 节点：跨周期后读源；失败用旧数据且本周期不重试；从未成功时每次请求都重试；手动刷新绕过判定；超过 3 秒先返回旧数据，后台刷新成功。
- 规则：跨周期立刻失效，且失败时**不返回旧内容**；失败不写表，下次请求会再次读源；有引用的规则也被清理。
- 相同 URL 被 1 个模板、3 个订阅、1 个增强引用时，只存 1 份、只拉 1 次。不同读取参数各存一份。
- 权限：其他用户不能通过 `/subs/ruleset` 读到别人配置的远端规则，即使缓存已存在。
- 节点订阅故障时，`/subs/ruleset` 和公共规则文件仍能下发。
- 主配置请求不调用任何规则读取（上游调用次数为 0）。
- 仓库索引：跨周期后定时器自动同步，读取目录和规则文件不触发同步；失败保留旧索引；从未成功时同一周期内不自动重试，手动同步可立即重试；同步过程不读取规则文件内容；`stop()` 后不再运行。
- 全局并发上限生效，相同身份仍只拉一次。
- 迁移：从带密文和绑定的 v34 以及带绑定的 v35 升级（如果新增 v36），节点快照可读，规则快照被清除，`resource_bindings` 已删除，重启幂等；多个订阅源绑定同一资源时都有快照。

## 8. 验收

### 8.1 自动

```bash
pnpm -r test
```

并在 `packages/core`、`packages/server`、`packages/web` 分别运行 `./node_modules/.bin/tsc --noEmit -p .`。

### 8.2 真实升级和链路

用 `07ccb5a`（v34）的代码生成旧库，再用分支代码启动；如果新增 v36，再用 `2284c50`（v35）的代码生成一份验证。启动方式：

1. 在主仓库创建临时的 `.claude/launch.json`（已被 git 忽略；`preview_start` 从主仓库读取）。配置上游静态服务 `python3 -I -m http.server 18089 --bind 127.0.0.1 --directory <夹具目录>`，和服务端 `env SUBFORGE_DB=<临时库> SSRF_ALLOW=127.0.0.1 PORT=18088 HOST=127.0.0.1 PUBLIC_URL=http://127.0.0.1:18088 ALLOWED_ORIGINS=http://127.0.0.1:18088 WEB_DIR=<分支>/packages/web/dist <分支>/packages/server/node_modules/.bin/tsx <分支>/packages/server/src/cli.ts serve`。
2. 先在 `packages/web` 运行 `./node_modules/.bin/vite build`。
3. 用内置浏览器访问 `http://127.0.0.1:18088`，不要用 `localhost`，否则跨源校验不通过。测试账号在夹具种子里生成，只用于本地。

检查项：

- 版本为最新结构版本，`resource_bindings` 已删除，节点快照可用，规则快照已清除。
- 启动后节点和规则文件上游没有请求；仓库索引到期时的后台 Git 同步属于预期，且不下载规则文件内容。
- 跨过周期边界后，不发任何请求，仓库索引也会自动同步。
- 主配置只触发节点来源读取；规则文件请求才触发规则读取。
- 把周期改短后，规则快照失效；删除上游文件后，规则文件返回错误，恢复后下次请求成功；节点上游失败时继续用旧数据。
- 系统页显示下次缓存失效时间，规则“待拉取”不是警告色，没有控制台错误。

结束后停止服务、删除临时 `.claude/launch.json` 和夹具，确认没有残留进程（全局规则要求）。

### 8.3 尚未验证、需要说明的事项

- 真实客户端的行为：规则文件返回错误时是否继续使用本地文件；规则文件只含注释时是否正常。
- 服务器到 GitHub 的实际网络质量。

## 9. 决策记录

| 决定 | 原因 | 被否决的方案 |
|---|---|---|
| 缓存只放上游，下游纯函数 | 分层清楚，下游不必理解缓存 | 保留转换产物表 |
| 删除 `last_good` | 上游故障由快照兜底，其余失败由客户端保留本地配置 | 保留上一份成功配置 |
| 删除公共规则产物表 | 实测 50 万行命中 656 ms、重新转换 2333 ms，节省有限，复杂度高 | 按 `last_read_at` 定时清理产物 |
| 节点和规则内容懒加载，去掉它们的后台拉取 | 空闲时不访问内容上游，也不再定期拉取没人用的内容 | 后台每 60 秒按 TTL 拉取内容 |
| 缓存周期为系统级 | 方便统一管理 | 每个资源单独计时；Cron 表达式 |
| 沿用“每 N 小时”，对齐本地 0 点 | 设置界面不变，客户端更新间隔能直接算出 | Cron 表达式 |
| 节点快照永不清理，失败顺延到下个周期 | 机场订阅有时不可用，必须始终保留一份可用副本 | 按引用清理节点快照 |
| 规则快照到期立刻清理，不管有没有引用 | 用户判定规则集和 GitHub 仓库默认全天可用 | 过期后再留一个周期作为兜底；只清理没有引用的 |
| 规则失败不缓存，可一直重试 | 失败结果不是有效数据 | 失败后退避 5 分钟或一个周期 |
| 文档、快照、令牌原文明文存储 | 默认部署主密钥与数据库同目录，防护有限；单次解密很快但复杂度高 | 全部保留加密；连备份和 HMAC 一起去掉 |
| 仓库的 Git 和文件目录索引不清理，由后台定时任务按全局周期同步，不下载文件内容 | 规则引用要靠索引校验；索引被删后主配置要等仓库同步。它是定时任务，不依赖请求 | 与规则快照一样到期清理；读取时按需同步 |
| 同一 URL 只存一份规则快照 | 缓存属于上游，下游身份不应进入缓存键；权限在入口校验 | 按配置、模板、作用域隔离缓存 |

**用户已知并接受的风险：** 周期一到，所有规则快照同时失效且没有旧数据。如果此时上游或服务器网络有问题，规则文件会一起失败直到恢复。已有设备通常继续用本地文件，新设备拿不到规则。

**节点“从未成功”这一项的说明：** 用户明确“失败不缓存、可一直重试”只针对规则，“节点失败顺延到下一周期”。随后确认的最终规则表中，节点从未成功时按“下次请求重试”处理，用户没有提出异议，所以本文按此实施：**有旧数据才顺延，没有旧数据就重试**。

## 10. 不要做

- 不要新增任何转换结果、渲染结果或下游缓存，也不要加内存 LRU 来缓存下发结果。
- 主配置请求不要读取规则正文或规则快照。
- 规则快照过期后不要作为旧数据返回。
- 节点快照不要按时间或引用清理。
- 不要恢复 `last_good`、`shared_rule_resources`、`resource_bindings`。
- 不要改动第 3 节列出的加密保留范围。
- 不要主动合并分支或推送；合并由用户决定。
