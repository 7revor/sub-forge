# @sub-forge/core

渲染内核（M0）：纯函数库，不做网络与存储 I/O。快照、模板、规则集都由调用方传入。

| 目录 | 内容 | 对应文档 |
| --- | --- | --- |
| `src/proxy` | 订阅内容解析：URI / Base64 / Clash YAML / Surge `[Proxy]` → `ProxyIR` | PRD SRC-01、SRC-04、SRC-10 |
| `src/pipeline` | 处理链与 P0 处理器，逐步 trace，末尾去重兜底 | SRC-06、SRC-07、SRC-11 |
| `src/nodeset` | 订阅源 / 组合 / 本地节点组解析，组合环检测 | COL-01–04、LOC-01 |
| `src/rules` | 规则 IR、规则集解析、按客户端降级与覆盖、规则包拆分 | RS-01–03、RB-01–05、CR-01–02 |
| `src/template` | 模板 ⊕ 覆盖层合并、模板发布前自检 | 03 §5、TPL-07 ①、PRF-04、PRF-09 |
| `src/render` | mihomo 渲染：依赖解析、代理链、引用校验、环检测 | 03 §4、REF-01–12 |

## 测试

```bash
pnpm --filter @sub-forge/core test
```

代理链集成测试需要真实的 mihomo 内核（v1.19.27+），未设置 `MIHOMO` 时自动跳过：

```bash
MIHOMO=/path/to/mihomo pnpm --filter @sub-forge/core test
```

## 尚未实现

- 脚本处理器与规则改写脚本（SRC-08、CR-03，需要沙箱，P1）
- 逻辑规则 AND / OR / NOT（RS-04，P1）
- Surge 输出（M2）
- 模板发布前的影响分析（TPL-07 ②，需要对每个 Profile 试渲染，由服务层调用 `renderMihomo` 实现）
- ssr、hysteria v1、wireguard、snell 的 URI 解析（这些协议目前只能通过 Clash YAML 导入）
