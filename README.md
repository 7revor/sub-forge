# Sub-Forge

面向小规模用户群体的**订阅聚合 + 分流配置生成**服务。
目标是取 Sub-Store 的"订阅加工"之长、取妙妙屋（miaomiaowu）的"可视化生成配置"之长，并补上两者都没解决好的问题：

- 节点加工全部是**纯函数流水线**（正则链/脚本），上游更新后结果始终确定、不会重复改名；
- **代理链 / 分流规则可以引用 proxy-provider 里的节点**，且不需要把多订阅源打平到本地；
- **两层规则集合**（规则包），以及**按客户端区分的规则改写**（如 mihomo 与 Surge 的进程规则差异）；
- **模板驱动**：模板只定义"分流"（proxy-group 骨架 + rule + 二者的关联），订阅基于模板填充节点，模板更新后订阅自动同步。

首期仅支持 **mihomo** 与 **Surge** 两个输出目标。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-competitive-analysis.md](docs/01-competitive-analysis.md) | Sub-Store / 妙妙屋 调研与问题分析 |
| [docs/02-PRD.md](docs/02-PRD.md) | 产品需求文档（核心概念、功能需求、优先级） |
| [docs/03-domain-model-and-pipeline.md](docs/03-domain-model-and-pipeline.md) | 领域模型、渲染流水线、依赖解析（代理链/规则引用 provider 节点）、模板合并算法 |
| [docs/04-client-matrix.md](docs/04-client-matrix.md) | mihomo / Surge 能力差异矩阵与输出映射 |
| [docs/05-roadmap-and-open-questions.md](docs/05-roadmap-and-open-questions.md) | 里程碑、技术选型建议、待决问题 |
| [docs/06-proxy-chain-research.md](docs/06-proxy-chain-research.md) | 代理链专项：基于 mihomo 源码的通解与风险 |
| [docs/07-verification-checklist.md](docs/07-verification-checklist.md) | 待核对清单：Surge / Loon / Stash / FlClash 文档与 mihomo 实测 |
| [docs/08-rule-repository-index.md](docs/08-rule-repository-index.md) | 新需求：内置规则仓库的搜索、索引与引用 |

## 状态

**M0 内核基本完成**（[packages/core](packages/core/README.md)）；**M1 进行中**：服务端切片已可用（[packages/server](packages/server/README.md)，存储、上游拉取、订阅接口，仅 mihomo），还没有管理接口、登录与前端。各里程碑进度见 [05 §1.1](docs/05-roadmap-and-open-questions.md#11-进度)。

- 需求：PRD v0.2，待决问题已暂定（[07 §8](docs/07-verification-checklist.md#8-决策记录)）；剩余需要 GUI / 真机 / 国内网络的采集项见 [07 §7.1](docs/07-verification-checklist.md#71-剩余采集项)，结果与暂定决策冲突时再修订。实测用例见 [research/verification](research/verification/README.md)。
- 设计：前端页面设计稿（21 张画板）在 Claude Design 画布 [Sub-Forge 前端页面设计](https://claude.ai/artifact/XceERK5VmwqhEPai8xevKd)，未纳入仓库；链接默认仅所有者可见，需要在页面的 Share 菜单中分享给他人。

```bash
pnpm install
pnpm test                                   # 单元测试与快照测试
MIHOMO=/path/to/mihomo pnpm test            # 另跑 mihomo -t 配置合法性校验（断网沙箱）
pnpm test:docker                            # Docker 断网容器内跑全部测试（含 GEOIP、代理链运行时、端到端）
```

本地试用订阅服务见 [packages/server](packages/server/README.md#运行)。

## 许可证

[AGPL-3.0](LICENSE)。部分协议解析代码将复用自 [Sub-Store](https://github.com/sub-store-org/Sub-Store)（AGPL-3.0）。
