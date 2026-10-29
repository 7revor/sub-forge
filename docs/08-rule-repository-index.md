# 08 · 新需求：内置规则仓库（搜索 / 索引 / 直接引用）

> **2026-10-29 更新：以本节和 `packages/server/README.md` 的 Git 缓存说明为准。** 新增、修改和目录同步全部改用匿名 Git；GitHub Token 配置与 API 依赖已移除。SQLite v14 清理旧凭据。下文 REST 同步及“内置仓库只可停用”的描述均为历史设计。
>
> 所有仓库统一使用可编辑扫描配置；两个默认仓库仅是初始化数据，支持编辑和删除。支持一个仓库多个分支和扫描范围，格式、客户端、分组、推荐路径及 README 解析均由配置控制，不再按仓库身份分派适配器。SQLite v13 原子保存索引、分支提交和生效配置；编辑后的同步失败仍使用原快照。Git 只浅取提交历史，目录扫描递归覆盖全部层级；正文按固定提交按需缓存，已导入来源继续跟踪分支更新。


> 状态：2026-10-29 已接通首期索引与搜索，当前索引政策为仅接受 `.list` / `.txt`；下文历史调研不代表当前支持范围。
> 已实现：两个内置仓库、SQLite v11 持久化、启动/每日 commit 检查、管理员手动更新与启停、失败保留旧索引、名称归一化搜索（忽略大小写、连字符、下划线与空格）、仓库/客户端筛选、分页、按需文本预览、变体选择、导入新规则集或追加为已有规则集的远程来源。
> 首期导入沿用 `remote` 来源与文本托管流程，默认选择推荐文本变体，不在渲染时动态切换仓库变体；YAML、MRS、SRS 等文件不进入索引。规则类型/内容搜索、来源注释随托管输出、动态 `repo` 引用、commit 锁定与上游消失检测仍未实现。下文默认 mrs/直连、YAML 专用索引决策已于 2026-10-29 撤销；替代为文本索引与托管转换。

### 自定义 GitHub 仓库（2026-10-29 已实现）

管理员在系统页添加公开 GitHub 仓库，配置显示名称、分支（留空取默认分支）、扫描目录、包含/排除路径和文本格式。仅接受 HTTPS GitHub 仓库主页地址；不接受凭据、文件链接或任意下载主机。同一仓库和分支不能重复添加。

- `generic` 首期严格一个文件一个条目，完整仓库路径（含扩展名）作为 key；同名不同目录或扩展名互不覆盖。暂不按客户端或同名文件聚合。
- glob 相对于扫描目录，支持 `*`、`**`、`?`。默认包含 `**/*.list`、`**/*.txt`；忽略 README、许可证、脚本、二进制与符号链接。文件扩展名仅决定候选，不证明内容有效。
- 格式可选自动识别、classical、域名列表、CIDR，应用于该仓库所有候选文件；在详情或导入时使用现有核心解析器读取内容。部分不支持行提供条数、行号与原因弹层；完全无法解析时禁止导入，失败可重试。
- 通用文本条目可出现在 mihomo / Surge 两种筛选中，最终兼容性由已有规则集渲染流程处理。导入保存普通 `remote` URL，不建立动态 repo 引用，不锁定 commit。与主分支关联功能整合后，导入和 resolve 均保留 repository 标识；保存与预览校验自定义仓库的规范 URL。
- 复用启动/每日检查、手动更新、失败保留旧索引与重启恢复。成功扫描无匹配文件时保存空索引；网络失败保留旧结果。索引进行中不可删除；删除自定义仓库会删除配置和索引，已导入来源保留；内置仓库仅可停用。
- `rule_repos.definition` 保存自定义配置；内置行为不变。配置编辑、私有仓库、鉴权令牌、路径模板、多文件变体聚合与逐用户可见范围留待后续。

### 首期实现说明

- 通过 GitHub REST commits/tree 读取文件清单；commit 未变时不拉文件树，递归树截断时改为非递归分目录遍历。每个仓库所有分支成功后才原子替换索引。首次失败显示错误，已有索引失败继续查询旧数据，15 分钟后自动重试；正常情况下每 24 小时检查。
- SQLite 保存公共仓库状态与归一化名称，数千条记录用参数化 `instr` 搜索；本期不需要 FTS 或外部搜索引擎。单页默认 50、上限 100 条。
- blackmatrix7 按完整目录分组，支持二级 key；详情/导入按需读取 README 的使用说明、无条件单独使用与共同使用建议，组合内文件全部加入来源。不把 IPv4 或客户端版本条件建议当成通用默认。
- zydou 归一化属性文件名的尾空格，但保留所有互补文件；丢弃 `@-` 属性。仅扫描 surge-rule-set / surge-domain-set 分支，默认选择 RULE-SET 文本，复用现有合并去重和快照逻辑。
- 搜索结果显示可用客户端；实际规则条数按需读取推荐文本变体后计算，未读取时不填假数据。详情显示上游文件、许可证与预览；预览失败有明确提示并可重试。
- 导入只允许使用索引中的文件，不能传任意 URL；追加仅可写入当前用户自己的规则集，保留原有来源与改写，相同 URL 不重复添加。
- 服务退出时停止定时器并等待索引任务，不留下后台 Git 或下载进程。示例种子保持离线可用，仓库元数据在服务初始化时自动建立，无需写进种子。

## 1. 需求

规则管理中内置若干 GitHub 规则仓库。用户可以**搜索**仓库中的规则集，然后**直接引用**到规则列表、规则集（作为来源）或模板中，不必手动找 URL、判断格式。

首批内置：

| 仓库 | 来源 | 许可证 |
| --- | --- | --- |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule) `master` | 作者自建的规则生成器，每日更新 | GPL-2.0 |
| [zydou/domain-list-community-converter](https://github.com/zydou/domain-list-community-converter/tree/surge-rule-set) 多个分支 | 转换自 v2fly/domain-list-community，每日构建 | 见仓库 |

## 2. 两个仓库的结构调研

### 2.1 blackmatrix7/ios_rule_script

- 布局：`rule/<客户端>/<规则名>[/<子规则名>]/<文件>`，客户端目录有 `Clash`、`Surge`、`Loon`、`QuantumultX`、`Shadowrocket`、`AdGuard`。
- 规模：`rule/` 下约 8.8k 个文件；仅 `rule/Clash` 就有约 669 个规则名，其中约 100 个有二级目录（如 `Assassin'sCreed/Assassin'sCreed-Odyssey`、`AdGuardSDNSFilter/Direct`）。
- **同一条规则在一个客户端下有多个变体**。Clash 目录的文件后缀统计：

  | 变体 | 数量 | 含义（来自各目录 README 的"使用说明"） |
  | --- | --- | --- |
  | `X.yaml` | 682 | `behavior: classical` |
  | `X_No_Resolve.yaml` | 679 | classical，IP 规则带 `no-resolve` |
  | `X.list` | 689 | 文本 classical |
  | `X_Classical.yaml` / `_Classical_No_Resolve.yaml` | 27 | 大规则集的完整 classical 版 |
  | `X_Domain.yaml` / `X_Domain.txt` / `X_Domain_For_Clash.txt` | ~20 | `behavior: domain` |
  | `X_IP.yaml` / `X_IP.txt`（及 `_No_IPv6`） | ~10 | `behavior: ipcidr` |

- **大规则集是拆开的，需要组合使用**。以 `China` 为例，README 的"配置建议"：
  ```
  - China_Classical.yaml 单独使用。
  - China.yaml、China_Domain.yaml 共同使用。
  - China_Resolve.yaml、China_Domain.yaml 共同使用。
  ```
  Surge 目录则有 `China.list`、`China_All.list`、`China_All_No_Resolve.list`、`China_Domain.list`、`China_Resolve.list`。
- 元数据：yaml 文件头有注释 `# NAME / UPDATED / DOMAIN: n / DOMAIN-SUFFIX: n / TOTAL: n`；README 有规则统计表、更新时间、使用说明、配置建议。

### 2.2 zydou/domain-list-community-converter

- **按格式分分支**，每个分支下都是扁平文件：

  | 分支 | 文件 | 用途 |
  | --- | --- | --- |
  | `clash` | `name.yml` | mihomo `behavior: domain` |
  | `mrs` | `name.mrs` | mihomo `behavior: domain, format: mrs`（二进制，体积小） |
  | `surge-rule-set` | `name.txt` | Surge RULE-SET（`DOMAIN-SUFFIX,…` / `DOMAIN,…`） |
  | `surge-domain-set` | `name.txt` | Surge DOMAIN-SET |

- 规模：每个分支约 2.1k 个文件。
- 命名：`name` 对应 v2fly 的列表名；`name@attr` 是只含某属性的子集（如 `apple@cn`、`openai@ads`、`cn@!cn`）。
- 只有域名类规则，没有 IP / 进程规则。
- 属性含义（07 F2）：`@cn` 为境外服务在中国大陆有接入点的域名；`@!cn` 为 v2fly 中带 `!cn` 属性的条目（已从 cn 列表剔除）。
- 构建异常（`convert.py` 的 bug，07 F2/F3）：
  - **带尾部空格的文件名**（如 `openai@ads .txt`）：属性切分时没有 strip，一行有多个属性时前面的属性名带空格。它与无空格的同名文件内容**不同**，两者是同一属性的互补子集，**并集才是完整集合**。surge-domain-set 分支 2109 个文件中有 97 个，其中 23 个没有无空格版本。
  - **`@-` 开头的属性**（如 `category-games-cn@-!cn`）：来自 v2fly 的选择性包含语法 `include:x @-!cn`，被误当作属性，文件内容是 `.include:kurogames` 这类无效行，应丢弃。

### 2.3 结论

两个仓库的组织方式完全不同，但可以归一成同一个模型：

> **逻辑规则集**（如 "OpenAI"）→ 若干**客户端变体**（mihomo 用哪个文件、什么 behavior / format；Surge 用哪个文件、RULE-SET 还是 DOMAIN-SET）→ 每个变体由 **1~N 个文件**组成（大规则集的"共同使用"）。

用户只需选择逻辑规则集，渲染时按目标客户端**自动挑选变体**。这和 PRD 中"一份规则，按客户端正确输出"（G5）的目标一致。

## 3. 领域模型

```ts
type RuleRepo = {
  id: ID; name: string; builtin: boolean;
  git: { owner: string; repo: string; refs: string[] };   // blackmatrix7: [master]; zydou: [clash, mrs, surge-rule-set, surge-domain-set]
  adapter: 'blackmatrix7' | 'zydou' | 'generic';
  adapterOptions?: GenericAdapterOptions;
  pin?: { ref: string; commit: string };   // 可选：锁定 commit
  indexedAt?: Time; indexedCommit?: Record<string, string>;
  license?: string;
};

type IndexedRuleSet = {           // 逻辑规则集
  repoId: ID;
  key: string;                    // "OpenAI"、"AdGuardSDNSFilter/Direct"、"apple@cn"
  displayName: string;
  parent?: string;                // 二级目录的父规则名
  attrs?: string[];               // zydou 的 @attr
  stats?: Partial<Record<RuleType, number>> & { total?: number };   // 来自文件头 / README
  upstreamUpdatedAt?: Time;
  variants: RuleVariant[];
};

type RuleVariant = {
  client: 'mihomo' | 'surge' | 'loon' | 'stash' | 'any';
  label: string;                  // "classical" / "domain + classical 组合" / "no-resolve"
  files: { path: string; ref: string; behavior: 'classical' | 'domain' | 'ipcidr' | 'domain-set'; format: 'yaml' | 'text' | 'mrs' }[];
  noResolve?: boolean;
  recommended?: boolean;          // 适配器给出的默认变体
};

// 引用：规则集来源新增 'repo'
type RuleSetSource =
  | { kind: 'remote'; url: string; format: string }
  | { kind: 'local'; content: string }
  | { kind: 'repo'; repoId: ID; key: string; variantPolicy?: VariantPolicy; mode: 'passthrough' | 'hosted' };

type VariantPolicy = { prefer?: 'smallest' | 'no-resolve' | 'classical'; perClient?: Partial<Record<Client, string /* label */>> };
```

### 3.1 适配器

| 适配器 | 规则 |
| --- | --- |
| `blackmatrix7` | 以 `rule/Clash/<key>` 为 mihomo 来源、`rule/Surge/<key>` 为 Surge 来源（Loon 等预留）；按文件后缀识别变体；**解析 README 的"使用说明"拿到 behavior，解析"配置建议"拿到文件组合**；统计数据取自文件头注释。README 句式是有限集合（07 F1）：`X 单独使用。`、`X、Y 共同使用。`、`纯IPv4网络` 前缀、`请使用 behavior: "…"`、`请使用RULE-SET / DOMAIN-SET`、`X与Y的区别…`，以及 `Surge 5.21.0(2952)以上/以下版本使用以下配置：` 版本分段；解析时跳过上游来源 URL 列表，遇到无法识别的句式记入索引报告 |
| `zydou` | 文件名 `name[@attr]` 即 key；`clash` 分支 → mihomo domain/yaml，`mrs` 分支 → mihomo domain/mrs，`surge-domain-set` → Surge DOMAIN-SET，`surge-rule-set` → Surge RULE-SET；默认 mihomo 推荐 mrs、Surge 推荐 DOMAIN-SET；索引时丢弃 `@-` 开头的属性；带尾部空格的文件与无空格同名文件合并为一个 key，引用它时自动转为托管模式（直连无法合并） |
| `generic` | 管理员给自定义仓库配置路径模板，如 `{client}/{key}/{key}{variant}.{ext}` 加后缀→behavior 映射表；不支持的布局就用"按文件索引"兜底（一个文件就是一个规则集，按内容自动识别格式） |

## 4. 引用模式

| 模式 | 输出 | 优点 | 限制 |
| --- | --- | --- | --- |
| **直连**（passthrough，默认） | 配置中直接写上游 URL（按仓库、分支与文件路径生成 raw.githubusercontent.com 地址）和变体的 behavior / format | 不经过本服务；可以用 mrs 等二进制格式 | 不能改写；该客户端必须有现成变体 |
| **托管**（hosted） | 本服务拉取、解析成 IR，按我们的地址下发（PRD RS-05） | 可以做客户端改写（CR-01~03）、作为来源与其他来源合并、去重 | 二进制格式（mrs）无法托管，只能改用文本变体 |

自动切换：引用被作为来源加进**多来源规则集**，或挂了**改写 / 脚本**时，自动切换为托管并在 UI 中说明原因。

## 5. 功能需求

| ID | 需求 | 优先级 |
| --- | --- | --- |
| REPO-01 | 内置两个仓库（blackmatrix7、zydou）及其适配器；管理员可启用 / 停用 | P0 |
| REPO-02 | **索引任务**：定时（默认每日）+ 手动触发。只在分支 commit 变化时重建索引。获取文件树的方式见 §6 | P0 |
| REPO-03 | **搜索**：按规则名模糊匹配（大小写、`-` `_` 空格不敏感），可按仓库、客户端可用性、规则类型（仅域名 / 含 IP / 含进程）筛选；结果显示统计、更新时间、各客户端可用变体 | P0 |
| REPO-04 | 详情页：变体列表、文件组合、规则预览（按需拉取前 N 行）、上游链接 | P0 |
| REPO-05 | **一键引用**：在规则列表、规则集来源、模板编辑器里都可以"从仓库添加"，生成 `{ kind: 'repo' }` 规则集；在规则集里可以多选批量加入为多个来源 | P0 |
| REPO-06 | 渲染时按客户端挑选变体：取 `variantPolicy.perClient`，没有就取适配器推荐；该客户端没有可用变体时，改为托管（从其他客户端的文本变体转换），仍不行就丢弃并告警 | P0 |
| REPO-08 | 上游消失检测：重建索引后，被引用的 key 不存在了 → 标红、通知引用者；已托管的继续使用最后快照 | P1 |
| REPO-09 | 锁定 commit：引用可固定在某个 commit（URL 中用 commit SHA），默认跟随分支 | P2 |
| REPO-10 | 管理员添加自定义仓库（generic 适配器），可配置可见用户 | P1 |
| REPO-11 | **内容搜索**（反查"哪个规则集包含 `chatgpt.com`"）：需要下载全部文件建立倒排索引，zydou 约 2k 个小文件可行，blackmatrix7 量较大，作为可选功能 | P2 |
| REPO-12 | 名称映射：同一服务在不同仓库中的 key 不同（如 `OpenAI` 与 `openai`），搜索结果按规范化名称并排展示，方便比较条目数 | P1 |
| REPO-13 | 许可证与来源展示：详情页标注仓库许可证和作者；托管下发的内容保留上游文件头的来源注释 | P0 |

## 6. 索引实现要点

| 方式 | 说明 | 结论 |
| --- | --- | --- |
| GitHub REST `git/trees/{ref}?recursive=1` | 一次请求拿到整棵树。未认证每小时 60 次；树过大时会被截断（`truncated: true`） | 可用；需要处理截断（截断时按目录分批拉） |
| `git clone --depth 1 --filter=blob:none --no-checkout` + `git ls-tree -r` | 只下载树、不下载文件内容；本次调研就是这么拿到两个仓库的文件列表的 | **推荐**：没有 API 限额，也能顺带拿到 commit SHA 判断是否需要重建索引 |
| README / 文件头解析 | blackmatrix7 每个目录要读 README，约 670 × 客户端数个小文件 | 按需读取：commit 变化时只读改动的目录（`git diff --name-only` 两个 commit） |

存储：索引放在 SQLite（含 FTS5 全文表做名称搜索），规模约几千行，无需外部搜索引擎。

## 7. 与现有设计的关系

- 规则集来源从 `remote | local` 扩展为 `remote | local | repo`。`repo` 是"带客户端变体的远程规则集"，其余流程（缓存、快照、IR、多来源合并、改写）不变。
- 模板可以引用仓库规则集，所以管理员维护模板时能直接从仓库挑规则。模板发布前校验（TPL-07）中，"规则集可拉取可解析"对仓库规则集也有效，另外要检查 key 是否还在索引中。
- 规则集拆分（03 §6）读取的是托管后的 IR。若规则集的来源全部是同一仓库的 domain 变体，可以优化为直接输出多个 passthrough provider，而不合并（P2）。

## 8. 决策（2026-10-28 暂定，见 [07 §8](07-verification-checklist.md#8-决策记录)）

| # | 问题 | 决策 |
| --- | --- | --- |
| R1 | 默认引用模式：直连还是托管 | 2026-10-29 更新：仓库导入及转换统一托管；原默认直连方案撤销 |
| R2 | 托管再分发 GPL-2.0 规则内容的合规方式（本项目是 AGPL-3.0） | 保留原文件头注释，并附来源 URL 与许可证名称（非正式法律意见） |
| R3 | mihomo 默认选 mrs 还是 yaml | 2026-10-29 更新：两者都不索引。使用 list/txt 文本；手动 YAML 远程来源自动转 LIST，仅托管 |
| R4 | 普通用户能否添加自定义仓库 | **仅限管理员** |

### 2026-10-29 补充：关联来源编辑

文本导入保留 `repository: { repo, entry, ref, path }`。规则集编辑页可通过懒加载搜索选择器直接关联默认推荐文本变体（互补文件全部加入）；解析接口不落库，保存前可撤销草稿。来源以链接图标区分自定义远程，关联 URL 只读，保存与预览接口均校验。存量名称与 URL 完全符合旧导入器的来源按当前索引补齐标识。本次仍不支持按渲染客户端动态切换变体。

### 2026-10-29 最终政策：仅 list/txt 索引，转换只能托管

文件扩展名是统一硬性白名单，包含内置与自定义适配器；yaml/yml/mrs/srs/json 等不会出现在搜索、详情、导入或关联选项。旧索引启动时原子清理，影响仓库重新拉取树，即使上游 commit 未变。历史调研中列出的 Clash/YAML/MRS 文件仅作背景资料，不再属于目标索引范围。

用户手动添加远程规则可使用 YAML payload，自动解析后经已有 IR 管线输出 LIST 文本，转换结果只能托管。输入格式与输出格式分别处理，不改原地址和快照，以便持续更新；服务返回转换诊断，不支持的条目明确报告。已保存的 YAML 来源与关联信息保留，不因清理公共索引丢失用户配置。

## 移除 GitHub Token（2026-10-29）

旧 Token 配置方案已撤销。新增和修改仓库通过 `git ls-remote --symref` 读取 HEAD 与所有分支；缺省分支使用远程 HEAD，保存前验证所有分支存在。空仓库或无效分支拒绝保存，Git 访问失败明确报错。无需配置凭据，不请求 GitHub API。许可证保留同仓库已有说明，或手动填写；新仓库不自动推断 SPDX。


## 首页按文件操作（2026-10-29）

仓库区位于首页上方，管理员可添加、删除自定义仓库、启停、刷新索引；内置仓库保留停用操作。系统页不再重复展示仓库列表。

下方搜索保留条目名、路径、仓库筛选和分页，去除客户端筛选。左侧列表与右侧详情独立滚动。右侧只显示按分支和路径去重后的文件列表，去除客户端、方式、推荐变体下拉和推荐内容预览。每行「新建规则集」仅导入选中 `.list`/`.txt` 文件并保存仓库关联；同路径不同分支分别显示，不能互相替代。原 `/entry` 与无 file 的 `/import` 保持兼容供现有关联选择器使用。


## 2026-10-29：逐层文件树分页

> 2026-10-29：本节目录树／逐层加载方案已被本文末尾的「规则来源平铺分页」替代；保留历史决策，当前不显示文件夹。

规则来源弹层统一单列文件树，无关键词初始折叠，搜索结果自动展开匹配路径。目录接口默认每层 30 项、最大 100 项，返回总数及下一页偏移；顶层只含本地候选与仓库入口，展开才查询对应目录。每层后续页通过「加载更多」获取，搜索仍覆盖完整索引。仓库浏览同步复用该组件；文件预览、引用身份和导入行为不变。


2026-10-29 修正：文件树按仓库真实路径分层，保留 `rule/Clash` 和 `rule/Surge`，不再去掉扫描根并合并同名分类。`directory` 参数改为相对仓库根的完整路径，旧目录缓存已包含原始路径，无需重建索引或修改已保存引用。

## 2026-10-29：规则来源平铺分页

当前候选接口为 `/api/rule-options/search`，替代 `/rule-options/catalog`。三处来源选择和仓库浏览直接分页物理文件，不返回仓库／目录入口，也不构建或展开树。默认 30、上限 100；响应包含下一页偏移和匹配总数。搜索匹配文件名、仓库名、完整路径和分支，忽略大小写及全半角；通配字符按字面处理。

SQLite `json_each` 读取文件元数据，筛选排序后执行 LIMIT/OFFSET；回退旧条目也不向应用层拉取全量文件。无搜索只请求第一页，点击加载更多追加下一页。选择单文件后继续校验仓库可用性与文件成员资格，再读取正文；旧已保存的聚合引用不改写。

2026-10-29 修正：上文仓库名／分支参与搜索的方案已移除。当前 `q` 仅匹配物理文件完整 path，文件名包含在其中；来源说明仍显示仓库和分支。总数与 LIMIT/OFFSET 均基于修正后的匹配集。

2026-10-29 候选 hint 改为父目录而非完整文件路径：例如 `仓库 · rule/Clash/China/ · 分支：master`，根目录使用 `/`。搜索仍基于完整文件 path，选中 value 不截断路径。响应的 matches 字段提供两行各自的原文命中区间，前端以 mark 渲染，仓库名与分支不因碰巧含有关键词而高亮。

2026-10-29 来源候选说明：默认 `repo name · path`，path 为可选父目录；根目录仅 `repo name`。同 repo 的当前搜索匹配集包含多个 ref 时显示 `repo name * branch * path`，path 仍可省略。统计分支在数据库中先于分页完成，不为展示读取全量文件。搜索字段、文件 value、分页协议不变。
