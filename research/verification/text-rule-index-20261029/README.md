# 文本索引与远程 YAML 托管转换验收

日期：2026-10-29。工作分支：`codex/rule-repo-index`。

## 自动化验证

- `pnpm test`：通过 653 项，跳过 28 项（core 160/23、server 270/3、web 223/2）。
- 后续补充无扩展名 YAML 来源不可改为透传的测试，运行 `pnpm --filter @sub-forge/server exec vitest run test/rule-conversion.test.ts`：4 项通过，包含该新增用例。
- `pnpm typecheck`：通过。
- `pnpm --filter @sub-forge/web build`：通过；保留原有大包体积提示。
- `git diff --check`：通过；示例种子 JSON 可解析。
- 内置与自定义索引的后缀白名单、旧缓存清理、相同上游 commit 下强制重建：单元测试通过。
- YAML 自动识别和显式输入格式的预览、保存、实际渲染：通过。输出 provider 为本服务地址和 `format: text`，不包含上游 YAML 地址；无法转换的行保留诊断。
- YAML 地址误设为 mrs/srs 的保存和预览被拒绝；无扩展名但原格式为 YAML 的来源也不能改成透传。

## 内置浏览器验收

使用 Codex 内置浏览器访问临时服务 `http://localhost:18187`，数据库为本工作树 `.Codex/verification/rule-repo-index/test.db`，未写生产库。

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| 手动添加真实 `clash/wise.yml`，自动识别、预览、保存 | passed | 得到 `transferwise.com`、`wise.com` 两条 DOMAIN-SUFFIX 规则，显示 `YAML → LIST · 托管`；见 [截图](yaml-managed.jpg) |
| 转换来源的输入格式选项 | passed | 不提供 mrs；提供自动识别、classical、DOMAIN-SET、CIDR、YAML 转 LIST |
| 仓库搜索 wise 并加载详情 | passed | 仅两个 `wise.txt` 文本变体，分别属于 surge-rule-set 与 surge-domain-set；见 [截图](text-index.jpg) |
| 自定义仓库默认扫描与格式选项 | passed | include 仅 `.list`、`.txt`；无 YAML 格式选项；见 [截图](custom-text-only.jpg) |
| 测试库旧索引清理 | passed | 2716 条目、5800 文件，不支持的后缀为 0 |
| 真实 GitHub 索引刷新 | failed | 两个内置仓库均返回 HTTP 403；页面保留已清理的旧缓存。不能据此宣称真实上游索引已重建；重建行为仅由模拟响应单元测试验证 |
| 外部设计画布同步 | not_run | 画布登录受限，待同步内容已记入 docs/11 与 docs/13 |

## 清理

临时服务 PID 78026 已终止，执行会话 82951 已以 0 退出；已恢复浏览器视口并关闭临时标签。保留隔离测试数据和截图作为验收证据。没有部署、推送或修改生产规则来源。
