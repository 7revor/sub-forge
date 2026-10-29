# 协议多选与空组固定拒绝验收

日期：2026-10-29。工作分支：`codex/group-filter-reject`。使用独立 worktree、临时 SQLite 数据库、专用本地域名和 Codex 内置浏览器；未操作真实订阅配置。

## 兼容性结论

- 生成时没有任何成员，或内联节点经过筛选后为空：自动补 `proxies: [REJECT]`，避免无成员配置被内核拒绝。
- 客户端加载、刷新或筛选 provider 后无节点：由自动生成的 `empty-fallback: REJECT` 处理，用户无需额外设置。
- 「节点仍在但失效」不是空组，按策略组原有逻辑处理，不把健康检查失败等同于空列表。
- 历史 `whenEmpty: direct` 与 `extra.empty-fallback: DIRECT` 均不能改变固定拒绝行为；数据结构仅为兼容旧数据保留废弃字段。
- Mihomo 自 v1.19.27 起原生支持 empty-fallback，项目最低版本不变。没有宣称旧 Clash 或未开放的 Surge 输出兼容。
- exclude-type 按内核 Adapter Type 输出，如 ss → Shadowsocks；节点预览、内联筛选和 provider 的协议含义一致。未知已有类型保留，可在下拉中取消。

来源：[Mihomo 组配置](https://wiki.metacubex.one/config/proxy-groups/#empty-fallback)、[内核空组处理](https://github.com/MetaCubeX/mihomo/blob/Meta/adapter/outboundgroup/groupbase.go)、[v1.19.27 发布记录](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.27)。

## 自动验证

- 常规全量测试：核心 192、服务端 326、前端 267 项通过；原有可选测试按环境跳过。
- 类型检查和前端构建通过，构建仍有既有的资源包体积提示。
- 使用本机已安装的 Mihomo v1.19.32，无下载或安装：新增空组运行时矩阵 16 项通过，覆盖 SELECT / URL-TEST / FALLBACK / LOAD-BALANCE 的静态空组、按名称筛空、按协议筛空、失效节点仍在列表。
- 空组实际代理请求返回 HTTP 502，测试目标服务命中数为 0；控制器列出 REJECT。失效节点场景只验证组成员仍为原节点，未将请求超时视为协议拒绝。
- 现有配置合法性与代理链集成套件另外通过 18 项；GEOIP 检查因未提供 MMDB 跳过。合计 34 项针对性真实内核验证通过。
- 曾尝试开启全部已有运行时套件，其中既有 `mihomo-rule-options.test.ts` 依赖 `127.0.0.2`，本机无法监听，报 EADDRNOTAVAIL / beforeAll 超时，未记为通过。未修改本机网络配置；该限制不影响上述针对性测试。

## 浏览器验收

1. 模板 exclude-type 为自绘多选下拉，可同时选择 Shadowsocks 与 HTTP、点击「不排除协议」清空、用 Home / 方向键 / 空格选择及 Escape 关闭。
2. 原始 YAML 写入标准 `exclude-type: Shadowsocks`，模板可以正常发布；详情表格没有「为空时」列。
3. 订阅继承模板排除协议后选择「不排除协议」，结果保持为空，不会重新继承原值。
4. 新增的四个私有地区组显示「空 · REJECT」且无空组编辑项，同样可以多选协议。
5. 无节点集的最终预览自动为四个私有空组补 REJECT、为所有组生成 empty-fallback: REJECT；错误 0，四条 group.empty 告警与四个空组一致。

截图：[模板多选](template-multiselect.png)、[订阅多选](profile-multiselect.png)、[清空模板继承值](inherited-clear.png)、[自动拒绝预览](empty-reject-preview.png)。

外部设计画布仍待同步，已登记到 docs/13。测试结束后停止本次 Vite、服务端和内核进程，保留 worktree。
