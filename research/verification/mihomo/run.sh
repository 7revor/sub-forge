#!/bin/bash
# 代理链实测：起"前置"(17001)/"落地"(17002) 两个 socks5 实例和本地 HTTP 目标(17080)，
# 逐个加载 cases/<name>/config.yaml，经 mixed-port 17890 发请求，打印两个实例的入站日志。
# 用法: MIHOMO=/path/to/mihomo ./run.sh [case ...]   （默认跑全部用例）
# 判读: 前置日志出现 "--> 127.0.0.1:17002" 且落地日志出现 "--> 127.0.0.1:17080" 即链路生效；
#       只有落地日志有记录 = 绕过前置直连（泄漏）。
set -u
cd "$(dirname "$0")"
M=${MIHOMO:?请设置 MIHOMO 为 mihomo 二进制路径}
WORK=$(mktemp -d)
pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null; wait 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

sleep_s() { perl -e "select(undef,undef,undef,$1)"; }
wait_port() { for _ in $(seq 1 50); do curl -s -o /dev/null -m 1 "$1" && return 0; sleep_s 0.1; done; return 1; }

mkdir -p "$WORK/entry" "$WORK/exit" "$WORK/web"
cp entry.yaml "$WORK/entry/config.yaml"; cp exit.yaml "$WORK/exit/config.yaml"
echo ok > "$WORK/web/index.html"
python3 -m http.server 17080 --bind 127.0.0.1 --directory "$WORK/web" > "$WORK/web.log" 2>&1 & pids+=($!)
"$M" -d "$WORK/entry" -f "$WORK/entry/config.yaml" > "$WORK/entry.log" 2>&1 & pids+=($!)
"$M" -d "$WORK/exit" -f "$WORK/exit/config.yaml" > "$WORK/exit.log" 2>&1 & pids+=($!)
wait_port http://127.0.0.1:17080/ || { echo "HTTP 目标未启动"; exit 1; }
sleep_s 0.5

run_case() {
  local c=$1 d="$WORK/cases/$1"
  mkdir -p "$d"; cp cases/"$c"/*.yaml "$d/"
  echo "################ $c"
  echo "== mihomo -t"; "$M" -t -d "$d" -f "$d/config.yaml" 2>&1 | grep -v 'level=info' | tail -3
  local e0 x0; e0=$(wc -l < "$WORK/entry.log"); x0=$(wc -l < "$WORK/exit.log")
  "$M" -d "$d" -f "$d/config.yaml" > "$d/client.log" 2>&1 & local pid=$!
  wait_port http://127.0.0.1:17909/version
  echo "== curl"; curl -s -m 6 -x socks5h://127.0.0.1:17890 http://127.0.0.1:17080/ -w ' [http=%{http_code}]\n' || echo " [curl 失败 rc=$?]"
  sleep_s 0.3
  echo "== 前置日志"; tail -n +$((e0+1)) "$WORK/entry.log" | grep -o '\[TCP\].*'
  echo "== 落地日志"; tail -n +$((x0+1)) "$WORK/exit.log" | grep -o '\[TCP\].*'
  echo "== 客户端告警"; grep -E 'level=(warning|error)' "$d/client.log" | grep -o 'msg=.*' | head -2
  kill $pid; wait $pid 2>/dev/null
}

if [ $# -gt 0 ]; then cases=("$@"); else cases=($(ls cases)); fi
for c in "${cases[@]}"; do run_case "$c"; done
