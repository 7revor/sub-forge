# 规则来源分页文件树验收

日期：2026-10-29。

使用隔离内存数据库、模拟 Git 索引和虚构文件正文，未连接生产数据。基于 `manual-rule-catalog-server.ts` 临时增加 75 个同目录文件。

## 已验证

- 规则集增强、模板、订阅三个入口共用单列文件树；无关键词时仓库全部折叠。
- 展开 Many 后首批显示 30 / 75 项；点击「加载更多」后显示 60 / 75 项，没有自动读取最后一页。
- 搜索未加载的 `file-074`，无需翻页即可命中；匹配的仓库及各级目录自动展开。清空搜索恢复折叠。
- 模板搜索 Dropbox 后自动展开深层路径；点击文件后草稿只增加所选单文件引用。
- 仓库搜索 China.list 显示跨扫描根的同名文件，点击后正确预览对应原文。
- 目录请求始终带 `offset` 和 `limit=30`；初始只读取根层，展开或搜索才读取对应目录。

## 自动检查

- 服务端：402 项通过，5 项按现有配置跳过。命令：`pnpm --filter @sub-forge/server exec vitest run --testTimeout=15000`。
- 前端：295 项通过，2 项按现有配置跳过。命令：`pnpm --filter @sub-forge/web test`。
- `pnpm typecheck` 与 `pnpm --filter @sub-forge/web build` 通过。
- 服务端首次默认超时下，既有本地 Git 缓存测试超过 5 秒；将运行参数放宽至 15 秒后，全套通过，未修改该测试或超时配置。
- 接口测试覆盖默认页大小、后代不随父级返回、跨页无重漏、越界空页、完整索引搜索、字面通配字符、权限隔离、非法参数及旧索引回退。

## 截图

- [规则集增强初始折叠](initial-collapsed.png)
- [搜索结果自动展开](search-expanded.png)
- [模板文件树](template-tree.png)
- [订阅文件树](profile-tree.png)
- [仓库搜索与正文](repository-search.png)

外部设计画布本轮仍显示「Sign in to view this page」，待同步事项已登记 `docs/13-design-canvas-sync.md`。
