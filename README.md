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

需求整理阶段，尚无代码。待核对项**第一轮采集已完成**（Surge 手册与离线校验、mihomo 代理链实测、规则仓库），剩余需要 GUI / 真机 / 国内网络的项见 [07 §7.1](docs/07-verification-checklist.md#71-剩余采集项)，全部完成后统一决策剩余问题。实测用例见 [research/verification](research/verification/README.md)。

## 许可证

[AGPL-3.0](LICENSE)。部分协议解析代码将复用自 [Sub-Store](https://github.com/sub-store-org/Sub-Store)（AGPL-3.0）。
