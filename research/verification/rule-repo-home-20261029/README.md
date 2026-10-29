# 规则仓库首页与单文件创建验收

日期：2026-10-29；工作分支：`codex/rule-repo-index`。

## 自动化验证

- `pnpm test`：661 项通过、28 项跳过（core 160/23、server 278/3、web 223/2）。
- `pnpm typecheck`：通过。
- `pnpm --filter @sub-forge/web build`：通过，仅原有包体积提示。
- `git diff --check`：通过。
- 新增接口用例验证：清单不发起上游请求、按分支和路径去重；单文件导入不受 README 组合影响；不同分支保留不同格式；加入已有规则集按 URL 去重；伪造路径、混用 file/variant、停用仓库、网络失败均不能创建错误规则集。
- 原有自定义仓库 `.list`/`.txt` 硬白名单与权限测试继续通过。

## 内置浏览器验收

使用 Codex 内置浏览器，临时服务 `http://localhost:18189`，内存数据库与模拟 GitHub 响应。模拟 blackmatrix7 包含 66 条目，其中 China 含 37 个文本文件与一个被排除的 YAML；模拟 zydou 包含相同路径的两个不同分支文件。没有向真实 GitHub 创建资源。

| 场景 | 状态 | 证据 |
| --- | --- | --- |
| 上方仓库管理、下方搜索与文件区 | passed | [首页截图](home.jpg)；无客户端筛选、方式列、推荐变体下拉或内容预览 |
| 左侧独立滚动 | passed | 左侧 scrollTop 由 0 到 1100，右侧维持 0，页面 scrollTop 为 0 |
| 右侧独立滚动 | passed | 右侧 scrollTop 到 1673，左侧仍为 1100，页面 scrollTop 为 0；通过内置浏览器 CDP 滚轮操作验证 |
| 按文件新建规则集 | passed | 点击 China_Domain.list 的按钮，跳转规则集，显示 1 个关联、DOMAIN-SET、只读原地址和一条规则；[截图](created-single-file.jpg) |
| 首页添加自定义仓库 | passed | 弹窗默认只包含 list/txt；添加临时验收仓库后得到 2 条文本索引，YAML 被排除 |
| 首页刷新、停用、启用 | passed | 点击刷新成功；停用后搜索 demo 为 0，启用后恢复 1 条匹配 |
| 首页删除自定义仓库 | passed | 确认后从仓库区与搜索中移除 |
| 首页 Token 入口 | passed | 打开 GitHub 索引认证弹窗，显示未配置与密码输入；本轮未修改凭据 |
| 搜索 China | passed | 防抖后显示 1 个匹配条目 |
| 900×900 窄屏 | passed | 上下排列、页面宽度等于 900，无横向溢出；外层滚动 215.5 后详情进入可操作区域，见 [初始布局](narrow.jpg) 与 [文件区](narrow-files.jpg) |
| 真实 GitHub 刷新 | not_run | 本轮验证页面与接口行为，GitHub 响应使用模拟数据 |
| 外部设计画布 | not_run | 此前登录受限，待同步内容见 docs/11 与 docs/13 |

## 清理

已删除本轮临时仓库，关闭浏览器标签并恢复视口。测试服务 PID 85357 已终止，执行会话 14354 以 0 退出，内存测试数据随之销毁。没有修改生产数据或合并 main。
