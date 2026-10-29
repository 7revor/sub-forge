# 模板白底与规则集行内编辑验收

日期：2026-10-29（Asia/Singapore）。基线：`main@d2bd01d`；分支：`codex/template-inline-rules`；工作树：`.Codex/worktrees/template-inline-rules`。未合并、未推送。

## 变更

- 策略组右侧编辑区改为 `bg-panel`，与列表和卡片统一白底，保留选中组蓝色强调。
- 规则集主行直接显示可更换的名称、出口、no-resolve、启用和删除；移除灰色展开详情以及重复名称、出口。
- 更换规则集只替换 matcher，保留规则身份、顺序和其余设置；无新接口、模型迁移或种子变更。
- 单条规则仍可展开编辑；出口只在主行显示。规则集错误仍在对应行内显示，可被自检定位。
- 390px 窄屏在同一卡片内换行，不需要展开。

## 环境

使用 Codex 内置浏览器，桌面默认 1280×720，手机 390×844。运行已有 `packages/server/test/manual-rule-reference-server.ts`，只监听 `127.0.0.1:5186`，使用内存数据库、固定仓库/正文夹具和明确的测试账号；不访问生产数据，也不代表实时 GitHub 网络验收。夹具的发布时钟为固定值，界面日期不代表本轮真实日期。

依赖通过 `pnpm install --offline --frozen-lockfile` 安装，下载数量 0；依赖声明、锁文件未变，无 Playwright 依赖。未安装或启动外部浏览器、Playwright、Chromium；只使用内置浏览器。

外部设计画布本轮打开后显示「Sign in to view this page」，无法直接修改；按仓库约定同步了 docs/11 与 docs/13 的待同步项。

## 自动检查

- `pnpm --filter @sub-forge/web test`：257 通过，2 项原有跳过。
- `pnpm --filter @sub-forge/server exec vitest run test/api-templates.test.ts test/template-rules-validation.test.ts test/rule-references.test.ts`：24 通过。
- `pnpm typecheck`：三个包通过。
- `pnpm --filter @sub-forge/web build`：通过，保留现有主包超过 500 kB 的构建提示。
- `git diff --check`：通过。

## 浏览器验收

| 场景 | 结果 |
| --- | --- |
| 新建模板策略组编辑区 | 背景计算值 `rgb(255, 255, 255)`，与白色卡片一致 |
| 引用本地 Google | 直接进入规则行，不显示详情展开区 |
| 行内修改出口为 DIRECT，打开 no-resolve，关闭启用 | 控件可用，未触发展开 |
| 从本地 Google 更换为仓库 Google | 仍为第 1 条，DIRECT、no-resolve=true、enabled=false 保持 |
| 新增单条 DOMAIN 规则、填写 example.test 后折叠 | 展开编辑正常，主行出口可用 |
| 切换原始配置并返回表单 | YAML 包含仓库身份映射、disabled、DIRECT、no-resolve；两条规则、顺序和设置保持 |
| 390px 窄屏 | 规则集选择、出口、no-resolve、启用、删除均可见；开关操作有效，页面宽度与视口均为 390px |
| 窄屏打开更换规则集弹层 | 左右边界为 8 / 382px，宽 374px，无视口溢出 |
| 发布前校验、创建隔离 v1、重新打开编辑 | 两条规则及顺序、仓库引用、DIRECT、no-resolve=true、enabled=false 持久化正确 |
| 浏览器控制台 | 错误日志为空 |

## 截图

- [策略组统一白底](01-groups.png)
- [规则集直接行内编辑](02-inline-rules.png)
- [390px 窄屏](03-mobile.png)
- [发布后重新打开](04-reopened.png)

## 清理

已恢复浏览器 viewport override，并关闭本轮临时标签。验收结束向本轮 5186 监听进程发送 SIGTERM，确认进程退出且端口不再监听；内存数据随进程退出清除。工作树和提交保留，由用户决定是否合并或删除。
