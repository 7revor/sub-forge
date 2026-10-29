# 规则来源获取与服务端转换

## 职责边界

规则集页面保留 mihomo、mihomo Android、Surge macOS、Surge iOS 切换。浏览器只保存原文、编辑草稿和选择状态，不执行解析、改写、去重或客户端转换。

- `RuleSourceService` 获取来源原文，返回拉取状态和解析诊断。已保存且读取参数未变化的远程来源沿用正式快照；草稿或修改后的读取参数使用隔离的短期缓存，不写正式快照。草稿按用户、地址、格式和拉取参数缓存，合并重复请求，上游同步读取最多并发四个。
- `RuleConverter` 不做网络或数据库访问。它接受原文、来源元数据、改写、IP 选项及客户端上下文，调用共享内核；解析结果按内容缓存，最多 64 项、约 16 MiB 序列化数据。
- `prepareRuleDocument` 和 `convertRuleDocuments` 为共享纯函数。管理接口及实际托管 LIST 文件调用相同的转换函数。原始透传仍遵循已有的输出格式判定。
- `useRulesetSources` 按来源缓存原文和诊断。名称、备注、客户端选择和改写不进入来源获取键。
- `RulesetPreview` 内部保存客户端与平台，仅请求服务端转换。更新保留旧输出并明确标注；切换到其他来源不冒用旧来源结果；失败可重新转换。

## 接口

### 已保存来源读取

`GET /api/rulesets/:id/sources/:source/content`

必须登录且拥有规则集。返回 `{ content?, status }`。二进制来源不伪造文本正文。

### 草稿来源读取

`POST /api/rulesets/source`

请求 `{ id?, source }`。`source` 包含来源 id、kind、地址或本地 content、format、repository、behavior、fetch；不要求先保存。该接口与 GET 共用 getter。使用 POST 是为了承载草稿正文和未保存参数。

`status` 的 `rules` 是解析成功数量，`rejected` 是格式错误或系统尚未支持解析的数量，`rejectedDetails` 最多包含 100 条详情。原文不截断；未解析的内容仍保留。目标客户端能力不参与这份状态。

### 通用转换

`POST /api/rules/convert`

请求示例：

```json
{
  "inputs": [{
    "source": { "id": "local", "kind": "local", "format": "auto" },
    "content": "DOMAIN,example.test\nPROCESS-NAME,Example\nUSER-AGENT,x*"
  }],
  "client": "surge",
  "platform": "ios",
  "overrides": [],
  "noResolve": false
}
```

可选 `sourceId` 选择单来源，否则合并启用来源。返回 `lines`、`origins`、`diagnostics`、`stats`、`delivery`、`passthrough`。

- `origins` 与 `lines` 一一对应，记录源 id 和源行号；组级追加使用 `$append` 定位到改写条目。
- `stats` 分开记录解析成功、未解析、改写移除/替换/追加、重复、客户端无法输出、降级、有效输出，以及有效输出的 domain/classical/ipcidr 数量。
- 转换不读取传入 URL；无正文的来源不会被暗中重新拉取。
- 请求体上限 16 MiB，最多 256 个来源。超过限制拒绝请求，不截断计算输入。
- 旧 `POST /api/rulesets/preview` 保留为组合接口，内部只编排 getter 和 converter；新页面不使用它。

## 行号与注释

转换按来源顺序和源文件顺序输出，不再为了统计按 domain/classical/ipcidr 重排。分类仅用于统计。

- 原注释和空行保留，LIST 不兼容的注释形式转为 `#`。
- 输入错误、系统尚未支持解析、改写移除、重复及客户端无法输出均保留为注释，不删除对应位置。
- 一条规则可能替换为多条时，依据全部客户端配置的最大展开宽度预留位置；未占用位置写注释。组级追加不匹配当前客户端时也保留注释。
- 相同来源和改写配置下，四个客户端结果行位一致；增加来源、修改原文或改变改写条数会改变布局。
- YAML 结构行转注释，条目关联原文件物理行。流式 YAML 同一物理行包含多条规则时按条目展开；输出行号并不等于 YAML 物理行号，应使用 `origins` 定位。
- 注释和预留行不计入有效规则数量。
- 单来源预览保留现有语义：可以查看禁用来源，不执行整组去重及组级追加。

## 界面诊断

来源区只显示“已解析 N 条 · 未解析 M 行”。弹层区分“输入格式有误”和“本系统暂未支持解析”，不显示客户端能力问题。

预览区单独列出“客户端无法输出”、降级和改写信息。源解析问题在输出中的原位置保留注释。固定文本区高度并始终挂载，更新时不以短小加载提示替换正文；详情默认折叠。

## 验证边界

本次未新增 USER-AGENT 或逻辑规则支持。不会依据 URL 名称猜测客户端能力，也不会把未知规则变成可执行透传规则。原始直连与二进制规则的既有能力边界保留。
