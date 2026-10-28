# 待核对项实测用例

[docs/07](../../docs/07-verification-checklist.md) 中实测类问题的可复现配置。

## mihomo（M1–M7）

```sh
MIHOMO=/path/to/mihomo ./mihomo/run.sh          # 全部用例
MIHOMO=/path/to/mihomo ./mihomo/run.sh m1 m5b   # 指定用例
```

脚本起"前置"(127.0.0.1:17001) / "落地"(127.0.0.1:17002) 两个 socks5 实例和一个本地 HTTP 目标(17080)，退出时自动清理。

| 用例 | 场景 | 07 编号 |
| --- | --- | --- |
| m1 | 前置在 provider（包装组）、落地在本地 | M1 |
| m2a / m2b | 落地在 provider，`dialer-proxy` 指向本地节点 / 本地组 | M2 |
| m3a | 同一 provider 内，落地 `dialer-proxy` 直接写前置名称 | M3 |
| m3b | 异源，落地 `dialer-proxy` 指向包装组 | M3 |
| m3c | 异源，落地 `dialer-proxy` 直接写另一 provider 的节点名 | M3 |
| m4 | `override.dialer-proxy` 整源走前置 | M4 |
| m5a / m5b | 包装组筛空，有 / 无 `empty-fallback: REJECT` | M5 |
| m6 | provider 内 `dialer-proxy` 指向不存在的名称 | M6 |
| m7 | 只有 `COMPATIBLE` 的组 | M7 |

## Surge（离线校验）

```sh
cd surge && for f in *.conf; do echo "$f: $(/Applications/Surge.app/Contents/Applications/surge-cli --check "$PWD/$f" 2>&1 | head -1)"; done
```

`surge-cli --check` 只做静态校验，不解析 `policy-path` 外部内容，且**对组成员中不存在的名称不报错**（见 `neg.conf`），所以涉及外部节点的结论仍需运行时验证。
