# Git 仓库重构合并 main 后复验

日期：2026-10-29。运行代码：`main@8a09b75ccf29ab697b23b2535c2e4eb3771202b1`。

## 整合

先在 `codex/git-repo-cache` 工作树整合 `main@cb46f02`，解决规则解析、通知与旧弹窗删除冲突，再将 main 快进到整合提交。保留 Git 固定 commit 缓存读取、动态配置和独立新增/编辑子页面，同时使用主干的 `parseRuleSourceContent` 自动识别内容与统一操作反馈。

新增回归场景：扫描配置为 classical，但缓存正文为 YAML payload，预览和单文件导入仍能识别。该测试在旧解析调用下会失败，整合后通过。

## 合并后自动验证

直接在主仓库 main 执行：

- `pnpm typecheck`：core、server、web 全部通过。
- `pnpm test`：729 项通过、30 项既有跳过；core 176/23、server 304/5、web 249/2（通过/跳过）。
- 生产 Docker 构建通过（包含 Web 构建），镜像 `sub-forge:main-git-repos-qa`，本次平台 linux/arm64。
- 镜像 ID：`sha256:b57eb38095b30fa688abf333f81f6c92bd91fc6ef9d74dd04f8377cce9cbf92f`。
- 容器内 Git 2.39.5、CA 证书文件非空、node 用户可写 `/data`，Git 缓存位于 `/data/rule-repo-cache`。
- `git diff --check` 通过，无残留合并冲突标记。

## 主干容器运行与内置浏览器

新建隔离数据卷和本地测试账户，访问 `http://localhost:18819`，未操作生产数据。

1. 无 GitHub Token，两个初始仓库真实同步得到 691 和 2025 条规则，共 2716 条。
2. 列表进入 zydou 独立编辑页，两个分支扫描范围正确回填。
3. 修改显示名称并保存，自动返回列表，异步同步完成仍为 2025 条；重新直接打开编辑页读到保存后的名称及范围。
4. 搜索 115，列出两个仓库结果，blackmatrix7 文件详情显示 Clash 与 Surge 的固定 commit 上游链接。
5. 选择 Clash 文件新建规则集成功，跳转规则集编辑页；10 条有效规则，0 条无法解析，来源保持仓库关联，主干原始来源下载策略仍生效。

截图：[编辑页面](edit.png)、[导入结果](import.png)。

测试容器及本次专用数据卷已删除，测试浏览器页已关闭；没有遗留测试服务。工作树和测试镜像保留，未推送远端。
