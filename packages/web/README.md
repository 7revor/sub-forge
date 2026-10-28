# @sub-forge/web

管理前端：React 19 + React Router 7 + TanStack Query + Tailwind 4，配色与布局取自设计稿（Claude Design 画布「Sub-Forge 前端页面设计」）。

## 开发

```bash
# 终端 1：后端（示例数据见 packages/server/README.md）
SUBFORGE_DB=./data/dev.db PORT=8787 PUBLIC_URL=http://127.0.0.1:5173 pnpm --filter @sub-forge/server start
# 终端 2：前端，/api /sub /p /r 代理到后端
SUBFORGE_API=http://127.0.0.1:8787 pnpm --filter @sub-forge/web dev
```

生产构建由服务端托管（`WEB_DIR=packages/web/dist`），生产镜像已包含，前端与接口同源。

## 页面

| 页面 | 说明 |
| --- | --- |
| 总览 | 配置订阅与订阅源状态，拉取失败的待处理项 |
| 订阅源 / 组合 | 拉取参数、快照历史；处理链编辑器（拖拽排序、启用开关、逐步预览差异） |
| 本地节点 | 表单或粘贴导入，前置引用 |
| 规则集 / 规则包 | 按 mihomo、Android、Surge macOS / iOS 预览最终输出；规则包子项与 no-resolve |
| 配置订阅 | 新建三步；详情七个标签：概览（订阅链接、访问日志）、基础设置、节点集、策略组、规则、代理链（依赖节点面板）、预览 |
| 模板 | 浏览骨架与版本；管理员用 JSON 编辑、即时自检、影响分析与发布 |
| 预设 / 用户 | 管理员 |

## 已知简化

- 模板编辑器用 JSON 编辑组与规则，没有做成表单式的可视化编辑。
- 订阅源的处理链需要先保存订阅源才能逐步预览（预览接口按已保存的订阅源取快照）。
- Surge 预览在 M2。
