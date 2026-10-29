# 规则来源原始目录结构验收

日期：2026-10-29。本记录补充上一轮分页文件树验收，历史截图保持原样。

修正前目录接口去掉扫描根，导致 `rule/Clash/China` 与 `rule/Surge/China` 显示在同一 China 分类中。现在保留完整仓库路径，`directory` 相对仓库根；两条路径分别展开、分页、搜索和选择。

验证使用 `packages/server/test/manual-rule-catalog-server.ts` 的隔离内存库与虚构正文。浏览器已确认无搜索时仓库折叠，搜索 China.list 时自动展开 `blackmatrix7/ios_rule_script → rule → Clash / Surge → China → China.list`，两份同名文件各自保留完整路径，见 [截图](original-paths.png)。三处来源及仓库浏览共用该目录接口与文件树组件。

自动检查：

- 服务端目录与规则引用测试 16 项通过，包含 Clash、Surge 各 35 个同名文件在各自目录独立分页和搜索。
- 前端目录映射测试 4 项通过，包含同名目录身份隔离和完整父路径透传。
- 服务端类型检查、前端类型检查及生产构建通过。

已有索引包含原始路径，无数据迁移或重新拉取上游文件的要求；已保存引用不变。分页、无搜索折叠、搜索默认展开的交互保持不变。
