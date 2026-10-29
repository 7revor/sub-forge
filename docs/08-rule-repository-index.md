# 08 · 新需求：内置规则仓库（搜索 / 索引 / 直接引用）

> 状态：需求分析草案。调研的是两个仓库的 `HEAD`（2026-10-25 / 26）。
> 2026-10-29：前端页面 `/rule-repo` 已按设计稿完成（搜索、仓库筛选、变体、内容预览、引用为规则集 / 加入规则包），系统页有仓库管理与 GitHub 镜像；服务端只有占位接口（`packages/server/src/api/pending.ts`），索引与引用尚未实现。

## 1. 需求

规则管理中内置若干 GitHub 规则仓库。用户可以**搜索**仓库中的规则集，然后**直接引用**到规则列表、规则包或模板中，不必手动找 URL、判断格式。

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
  urlTemplate: string;            // 默认 https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}；可改为 jsDelivr 或自建镜像
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
| **直连**（passthrough，默认） | 配置中直接写上游 URL（按 `urlTemplate` 生成）和变体的 behavior / format | 不经过本服务；可以用 mrs 等二进制格式 | 不能改写；该客户端必须有现成变体 |
| **托管**（hosted） | 本服务拉取、解析成 IR，按我们的地址下发（PRD RS-05） | 可以做客户端改写（CR-01~03）、合并进规则包、去重 | 二进制格式（mrs）无法托管，只能改用文本变体 |

自动切换：引用被加进**规则包**，或挂了**改写 / 脚本**时，自动切换为托管并在 UI 中说明原因。

## 5. 功能需求

| ID | 需求 | 优先级 |
| --- | --- | --- |
| REPO-01 | 内置两个仓库（blackmatrix7、zydou）及其适配器；管理员可启用 / 停用 | P0 |
| REPO-02 | **索引任务**：定时（默认每日）+ 手动触发。只在分支 commit 变化时重建索引。获取文件树的方式见 §6 | P0 |
| REPO-03 | **搜索**：按规则名模糊匹配（大小写、`-` `_` 空格不敏感），可按仓库、客户端可用性、规则类型（仅域名 / 含 IP / 含进程）筛选；结果显示统计、更新时间、各客户端可用变体 | P0 |
| REPO-04 | 详情页：变体列表、文件组合、规则预览（按需拉取前 N 行）、上游链接 | P0 |
| REPO-05 | **一键引用**：在规则列表、规则包、模板编辑器里都可以"从仓库添加"，生成 `{ kind: 'repo' }` 规则集；规则包中可以多选批量加入 | P0 |
| REPO-06 | 渲染时按客户端挑选变体：取 `variantPolicy.perClient`，没有就取适配器推荐；该客户端没有可用变体时，改为托管（从其他客户端的文本变体转换），仍不行就丢弃并告警 | P0 |
| REPO-07 | 镜像：每个仓库可设置 `urlTemplate`（raw.githubusercontent.com / jsDelivr / 自定义加速前缀），也可按 Profile 覆盖，照顾访问不了 raw.githubusercontent.com 的用户 | P1 |
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

- 规则集来源从 `remote | local` 扩展为 `remote | local | repo`。`repo` 是"带客户端变体的远程规则集"，其余流程（缓存、快照、IR、规则包、改写）不变。
- 模板可以引用仓库规则集，所以管理员维护模板时能直接从仓库挑规则。模板发布前校验（TPL-07）中，"规则集可拉取可解析"对仓库规则集也有效，另外要检查 key 是否还在索引中。
- 规则包拆分（03 §6）读取的是托管后的 IR。若规则包内全部是同一仓库的 domain 变体，可以优化为直接输出多个 passthrough provider，而不合并（P2）。

## 8. 决策（2026-10-28 暂定，见 [07 §8](07-verification-checklist.md#8-决策记录)）

| # | 问题 | 决策 |
| --- | --- | --- |
| R1 | 默认引用模式：直连还是托管 | **直连**，可切换 jsDelivr 等镜像；需要改写或合并（如 zydou 带空格文件）时自动转为托管 |
| R2 | 托管再分发 GPL-2.0 规则内容的合规方式（本项目是 AGPL-3.0） | 保留原文件头注释，并附来源 URL 与许可证名称（非正式法律意见） |
| R3 | mihomo 默认选 mrs 还是 yaml | **mrs**；托管时输出 yaml |
| R4 | 普通用户能否添加自定义仓库 | **仅限管理员** |
