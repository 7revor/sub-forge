# MetaCubeX 兼容性样本

2026-10-29 从 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite) 的 `meta` 分支获取 `bilibili.list`、`bilibili.yaml`、`bilibili.mrs`，保留真实内容用于离线格式等价回归。三个文件均表示 53 条域名规则。

MRS 读取规范依据 Mihomo 官方 `Meta` 分支的 `rules/provider/mrs_reader.go`、`component/trie/domain_set_bin.go`、`component/cidr/ipcidr_set_bin.go`；项目中使用自行实现的数据解码器。
