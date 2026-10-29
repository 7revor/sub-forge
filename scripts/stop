#!/bin/bash
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 Python 3，请安装后重新运行。" >&2
  exit 1
fi
exec python3 "$SCRIPT_DIR/local-service.py" stop
