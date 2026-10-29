# 规则集整组 no-resolve 入口移除验收

日期：2026-10-29。基于 main 的独立 worktree `codex/remove-ruleset-no-resolve`。

- 移除规则集新建／编辑页来源卡片底部的整组 no-resolve 开关，列表同步移除对应列。
- 保留旧字段、预览及渲染兼容；单条规则与模板引用选项不变。
- `pnpm --filter @sub-forge/web build` 通过，包含 TypeScript 检查；Vite 提示现有大体积 chunk。
- 内置浏览器在隔离实例验证新建、添加本地来源、保存、刷新重读、合并预览、列表：开关与列表列均已消失；规则内容中的 `IP-CIDR,192.0.2.0/24,no-resolve` 保存重读和预览后仍保留，输出 2 条规则。
- 截图：`edit.png`、`list.png`。
- 外部设计稿打开后要求登录，未修改；待同步项已登记在 `docs/11-design-coverage.md`。
- 测试使用独立数据库与 15191／18091 端口，验收后停止本次启动的服务。
